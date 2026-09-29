"""
Email sending utility with retry logic, proper error handling, and production-ready SMTP configuration.
"""
import smtplib
import socket
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

class EmailSender:
    """Handles email sending with retry logic and proper error handling."""
    
    def __init__(self, sender_email, sender_password, max_retries=3, timeout=30):
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
        Establish SMTP connection with retry logic.
        
        Returns:
            bool: True if connection successful, False otherwise
        
        Raises:
            smtplib.SMTPAuthenticationError: If credentials are invalid
            Exception: For other connection errors (will log and raise)
        """
        for attempt in range(1, self.max_retries + 1):
            try:
                logger.info(f"[Attempt {attempt}/{self.max_retries}] Connecting to SMTP server...")
                
                # Set socket timeout globally for this connection
                socket.setdefaulttimeout(self.timeout)
                
                # Create SMTP connection with explicit timeout
                self.server = smtplib.SMTP(
                    'smtp.gmail.com',
                    587,
                    timeout=self.timeout
                )
                
                # Enable debug logging if needed
                # self.server.set_debuglevel(1)
                
                # Identify ourselves and wait for response
                self.server.ehlo()
                
                # Start TLS encryption
                logger.info("Starting TLS...")
                self.server.starttls()
                
                # Re-identify ourselves over the encrypted connection
                self.server.ehlo()
                
                # Login with credentials
                logger.info("Authenticating...")
                self.server.login(self.sender_email, self.sender_password)
                
                logger.info("✅ SMTP connection successful!")
                return True
                
            except smtplib.SMTPAuthenticationError as e:
                logger.error(f"❌ Authentication failed: {e}")
                self.server = None
                raise  # Don't retry on auth errors
                
            except (socket.timeout, socket.gaierror, ConnectionRefusedError, ConnectionResetError, OSError) as e:
                logger.warning(f"⚠️  Connection attempt {attempt} failed: {type(e).__name__}: {e}")
                self.server = None
                
                if attempt < self.max_retries:
                    wait_time = 2 ** attempt  # Exponential backoff: 2s, 4s, 8s
                    logger.info(f"Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"❌ Failed to connect after {self.max_retries} attempts")
                    raise
                    
            except Exception as e:
                logger.error(f"❌ Unexpected error: {type(e).__name__}: {e}")
                self.server = None
                raise
        
        return False
    
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
