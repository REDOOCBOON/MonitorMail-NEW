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

import os
import re

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
        """
        Send a single email with optional attachment.
        
        Args:
            to_email: Recipient email address
            subject: Email subject
            body_html: HTML email body
            cc_email: CC recipient (optional)
            attachment_data: Binary attachment data (optional)
            attachment_filename: Attachment filename (optional)
        
        Returns:
            tuple: (success: bool, message: str)
        """
        try:
            # Header values must be single-line: stops header injection (e.g. a Bcc smuggled into the subject)
            to_email = _single_line(to_email)
            cc_email = _single_line(cc_email) if cc_email else None
            subject = _single_line(subject)[:250]
            msg = MIMEMultipart()
            msg['From'] = self.sender_email
            msg['To'] = to_email
            if cc_email:
                msg['Cc'] = cc_email
            msg['Subject'] = subject
            
            # Attach HTML body
            msg.attach(MIMEText(body_html, 'html'))
            
            # Attach file if provided
            if attachment_data and attachment_filename:
                part = MIMEBase('application', 'octet-stream')
                part.set_payload(attachment_data)
                encoders.encode_base64(part)
                safe_name = re.sub(r'[^A-Za-z0-9._ -]', '_', os.path.basename(attachment_filename))[:120] or 'attachment'
                part.add_header('Content-Disposition', 'attachment', filename=safe_name)
                msg.attach(part)
            
            # Determine recipients
            recipients = [to_email]
            if cc_email and cc_email not in recipients:
                recipients.append(cc_email)
            
            # Send email
            self.server.sendmail(self.sender_email, recipients, msg.as_string())
            logger.info(f"✅ Email sent to {to_email}")
            return True, "Email sent successfully"
            
        except smtplib.SMTPException as e:
            error_msg = f"SMTP error: {e}"
            logger.error(f"❌ {error_msg}")
            return False, error_msg
        except Exception as e:
            error_msg = str(e)
            logger.error(f"❌ Unexpected error sending email: {error_msg}")
            return False, error_msg
    
    def send_emails_batch(self, email_list, subject, body_html, attachment_data=None, attachment_filename=None):
        """
        Send emails to multiple recipients.
        
        Args:
            email_list: List of dicts with 'to', 'cc' (optional), 'name' keys
            subject: Email subject
            body_html: HTML email body
            attachment_data: Binary attachment data (optional)
            attachment_filename: Attachment filename (optional)
        
        Returns:
            list: Results for each email
        """
        results = []
        
        for idx, email_info in enumerate(email_list, 1):
            try:
                to_email = email_info.get('to')
                cc_email = email_info.get('cc')
                
                if not to_email or '@' not in to_email:
                    results.append({
                        'email': to_email or 'Unknown',
                        'status': 'failed',
                        'reason': 'Invalid email address'
                    })
                    continue
                
                success, msg = self.send_email(
                    to_email=to_email,
                    subject=subject,
                    body_html=body_html,
                    cc_email=cc_email,
                    attachment_data=attachment_data,
                    attachment_filename=attachment_filename
                )
                
                results.append({
                    'email': to_email,
                    'status': 'success' if success else 'failed',
                    'reason': msg if not success else None
                })
                
            except Exception as e:
                results.append({
                    'email': email_info.get('to', 'Unknown'),
                    'status': 'failed',
                    'reason': str(e)
                })
            
            logger.info(f"Progress: {idx}/{len(email_list)}")
        
        return results
    
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
