"""
Email sending utility with retry logic, proper error handling, and production-ready SMTP configuration.
"""
import smtplib
import socket
import ssl
import time
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

# Configure logging
logger = logging.getLogger(__name__)


def _single_line(value):
    return re.sub(r'[\r\n]+', ' ', str(value or '')).strip()

SMTP_HOST = 'smtp.gmail.com'
SMTP_ENDPOINTS = [(587, False), (465, True)]  # STARTTLS first, then implicit SSL


def _tls_context():
    """Verified TLS (smtplib's default STARTTLS does not check the server certificate)."""
    return ssl.create_default_context()


def _ipv4_address(host):
    # Many containers have no IPv6 route; Gmail resolves to IPv6 first, which fails with "Network is unreachable"
    return socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]


class _IPv4SMTP(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return socket.create_connection((_ipv4_address(host), port), timeout, self.source_address)


class _IPv4SMTP_SSL(smtplib.SMTP_SSL):
    def _get_socket(self, host, port, timeout):
        sock = socket.create_connection((_ipv4_address(host), port), timeout, self.source_address)
        return self.context.wrap_socket(sock, server_hostname=host)


def build_message(sender_email, to_email, subject, body_html, cc_email=None, attachment_data=None, attachment_filename=None):
    """Build the MIME message. Returns (message, [recipients])."""
    # Header values must be single-line: stops header injection (e.g. a Bcc smuggled into the subject)
    to_email = _single_line(to_email)
    cc_email = _single_line(cc_email) if cc_email else None
    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = to_email
    if cc_email:
        msg['Cc'] = cc_email
    msg['Subject'] = _single_line(subject)[:250]
    msg.attach(MIMEText(body_html, 'html'))
    if attachment_data and attachment_filename:
        part = MIMEBase('application', 'octet-stream')
        part.set_payload(attachment_data)
        encoders.encode_base64(part)
        safe_name = re.sub(r'[^A-Za-z0-9._ -]', '_', os.path.basename(attachment_filename))[:120] or 'attachment'
        part.add_header('Content-Disposition', 'attachment', filename=safe_name)
        msg.attach(part)
    recipients = [to_email] + ([cc_email] if cc_email and cc_email != to_email else [])
    return msg, recipients


class EmailSender:
    """Handles email sending with retry logic and proper error handling."""
    
    def __init__(self, sender_email, sender_password, max_retries=2, timeout=15):
        """
        Initialize email sender.
        
        Args:
            sender_email: Gmail email address
            sender_password: Gmail app password
            max_retries: Number of retries on transient failures (default: 3)
            timeout: Socket timeout in seconds (default: 30)
        """
        self.sender_email = sender_email
        self.sender_password = sender_password
        self.max_retries = max_retries
        self.timeout = timeout
        self.server = None
    
    def connect(self):
        """
        Log in to Gmail over SMTP. Tries port 587 (STARTTLS) and then 465 (SSL), over IPv4, with retries.

        Raises:
            smtplib.SMTPAuthenticationError: If credentials are invalid (not retried)
            OSError: If Gmail can't be reached on any port
        """
        last_error = None
        for attempt in range(1, self.max_retries + 1):
            for port, use_ssl in SMTP_ENDPOINTS:
                try:
                    logger.info(f"[Attempt {attempt}/{self.max_retries}] Connecting to {SMTP_HOST}:{port}...")
                    if use_ssl:
                        self.server = _IPv4SMTP_SSL(SMTP_HOST, port, timeout=self.timeout, context=_tls_context())
                    else:
                        self.server = _IPv4SMTP(SMTP_HOST, port, timeout=self.timeout)
                        self.server.ehlo()
                        self.server.starttls(context=_tls_context())
                    self.server.ehlo()
                    self.server.login(self.sender_email, self.sender_password)
                    logger.info(f"✅ SMTP connection successful (port {port})")
                    return True

                except smtplib.SMTPAuthenticationError as e:
                    logger.error(f"❌ Authentication failed: {e}")
                    self._discard()
                    raise  # Don't retry on auth errors

                except (socket.timeout, socket.gaierror, ConnectionError, OSError, smtplib.SMTPServerDisconnected) as e:
                    logger.warning(f"⚠️  {SMTP_HOST}:{port} failed: {type(e).__name__}: {e}")
                    self._discard()
                    last_error = e

            if attempt < self.max_retries:
                wait_time = 2 ** attempt
                logger.info(f"Retrying in {wait_time} seconds...")
                time.sleep(wait_time)

        logger.error(f"❌ Could not reach {SMTP_HOST} on ports 587 or 465 after {self.max_retries} attempts. "
                     "If this runs on a cloud host, it may be blocking outgoing SMTP.")
        raise last_error or OSError('SMTP connection failed')

    def _discard(self):
        try:
            if self.server:
                self.server.close()
        except Exception:
            pass
        self.server = None

    def send_email(self, to_email, subject, body_html, cc_email=None, attachment_data=None, attachment_filename=None):
        """Send one email. Returns (success: bool, message: str)."""
        try:
            msg, recipients = build_message(self.sender_email, to_email, subject, body_html, cc_email, attachment_data, attachment_filename)
            self.server.sendmail(self.sender_email, recipients, msg.as_string())
            logger.info(f"✅ Email sent to {recipients[0]}")
            return True, "Email sent successfully"
        except smtplib.SMTPException as e:
            logger.error(f"❌ SMTP error: {e}")
            return False, f"SMTP error: {e}"
        except Exception as e:
            logger.error(f"❌ Unexpected error sending email: {e}")
            return False, "Unexpected error while sending"

    def logout(self):
        """Safely close SMTP connection."""
        try:
            if self.server:
                self.server.quit()
                logger.info("SMTP connection closed")
        except Exception as e:
            logger.warning(f"Error closing connection: {e}")
            try:
                if self.server:
                    self.server.close()
            except:
                pass
        finally:
            self.server = None
    
    def __enter__(self):
        """Context manager entry."""
        self.connect()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.logout()
        return False


# --- Gmail API (HTTPS) sender: works where SMTP ports are blocked, e.g. free cloud hosting ---
GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'


class GmailAuthError(Exception):
    """The teacher's Google permission was revoked or expired; they must connect Gmail again."""


def http_json(url, form=None, body=None, token=None, method='POST', timeout=20):
    """Minimal HTTPS JSON client. Returns (status, parsed_json)."""
    headers = {'Accept': 'application/json'}
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    elif body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else {}
        except ValueError:
            return e.code, {}


class GmailApiSender:
    """Same interface as EmailSender, but sends through the Gmail API using the teacher's OAuth permission."""

    def __init__(self, sender_email, refresh_token, client_id, client_secret, timeout=20):
        self.sender_email = sender_email
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.timeout = timeout
        self.access_token = None

    def connect(self):
        status, data = http_json(GOOGLE_TOKEN_URL, form={
            'grant_type': 'refresh_token', 'refresh_token': self.refresh_token,
            'client_id': self.client_id, 'client_secret': self.client_secret,
        }, timeout=self.timeout)
        if status == 200 and data.get('access_token'):
            self.access_token = data['access_token']
            return True
        if data.get('error') in ('invalid_grant', 'unauthorized_client'):
            raise GmailAuthError(data.get('error_description') or data['error'])
        raise ConnectionError(f"Google token endpoint returned {status}")

    def send_email(self, to_email, subject, body_html, cc_email=None, attachment_data=None, attachment_filename=None):
        try:
            msg, recipients = build_message(self.sender_email, to_email, subject, body_html, cc_email, attachment_data, attachment_filename)
            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
            status, data = http_json(GMAIL_SEND_URL, body={'raw': raw}, token=self.access_token, timeout=self.timeout)
            if status == 401:  # access token expired mid-run: refresh once and retry
                self.connect()
                status, data = http_json(GMAIL_SEND_URL, body={'raw': raw}, token=self.access_token, timeout=self.timeout)
            if 200 <= status < 300:
                logger.info(f"✅ Email sent via Gmail API to {recipients[0]}")
                return True, "Email sent successfully"
            reason = (data.get('error') or {}).get('message', f'HTTP {status}') if isinstance(data.get('error'), dict) else f'HTTP {status}'
            logger.error(f"❌ Gmail API error: {reason}")
            return False, f"Gmail refused the email: {reason}"
        except GmailAuthError:
            return False, 'Gmail permission expired. Please connect Gmail again.'
        except Exception as e:
            logger.error(f"❌ Gmail API send failed: {type(e).__name__}: {e}")
            return False, "Could not reach Gmail. Please try again."

    def logout(self):
        self.access_token = None
