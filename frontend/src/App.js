
import React, { useState, useCallback, useEffect } from 'react';
import {
    Box, Typography, TextField, Button, Grid, Paper, CircularProgress,
    Modal, Fade, IconButton, Snackbar, Alert, Link,
    Checkbox, FormControlLabel, LinearProgress, Select, MenuItem, FormControl, InputLabel,
    List, ListItem, Divider, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Chip, Stack, ToggleButton, ToggleButtonGroup, Collapse,
    Tooltip, InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { ThemeProvider, alpha } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import AttachmentIcon from '@mui/icons-material/Attachment';
import BarChartIcon from '@mui/icons-material/BarChart';
import PeopleIcon from '@mui/icons-material/People';
import SendIcon from '@mui/icons-material/Send';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import HistoryIcon from '@mui/icons-material/History';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import * as api from './api';
import theme, { tokens } from './theme';
import { AppShell, AuthShell, BusyButton, PageHeader, Section, StatCard, EmptyState, StatusChip, Mono, Dropzone, ConfirmDialog, ActivityChart, timeAgo } from './ui';
import './App.css';

const ATTENDANCE_THRESHOLD = 75;
const DEFAULT_EMAIL_SUBJECT = 'Important: Low Attendance Notification';
const GMAIL_APP_PASSWORD_URL = 'https://myaccount.google.com/apppasswords';

// "KASHRITA THAPA" -> "Kashrita Thapa"
const toTitleCase = (text = '') => text.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());

const formatSubjectList = (subjects = []) =>
    subjects.map(s => `  • ${s.Subject || s.course_title}: ${Number(s.Percentage ?? s.attn_percent).toFixed(2)}%`).join('\n');

const GmailAppPasswordField = ({ value, onChange, disabled, senderEmail }) => {
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null); // { ok, message }
    useEffect(() => { setTestResult(null); }, [value]);
    const handleTest = async () => {
        setTesting(true);
        try {
            const result = await api.testEmailConnection(value);
            setTestResult({ ok: true, message: result.message });
        } catch (err) {
            setTestResult({ ok: false, message: err.message });
        } finally { setTesting(false); }
    };
    return (
        <Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                    fullWidth
                    size="small"
                    label="Gmail app password"
                    type="password"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    disabled={disabled}
                    placeholder="16-character app password"
                    autoComplete="off"
                />
                <Tooltip title="Check the password with Gmail without sending anything">
                    <span>
                        <BusyButton variant="outlined" startIcon={<WifiTetheringIcon />} loading={testing} onClick={handleTest} disabled={disabled || !value.trim()} sx={{ height: 40 }}>Test</BusyButton>
                    </span>
                </Tooltip>
            </Box>
            {testResult ? (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: testResult.ok ? tokens.accent : tokens.danger }}>
                    {testResult.ok ? '✓ ' : ''}{testResult.message}
                </Typography>
            ) : (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    Sent from <strong>{senderEmail}</strong>. Create one at{' '}
                    <Link href={GMAIL_APP_PASSWORD_URL} target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</Link>. Kept only until you sign out.
                </Typography>
            )}
        </Box>
    );
};

const PASSWORD_RULES = 'At least 8 characters, with a letter and a number';
const passwordProblem = (password) => {
    if (password.length < 8) return 'Password must be at least 8 characters long.';
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number.';
    return null;
};

const AuthHeading = ({ title, subtitle }) => (
    <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1">{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{subtitle}</Typography>}
    </Box>
);

const FieldLabel = ({ children }) => (
    <Typography component="label" variant="body2" sx={{ display: 'block', fontWeight: 500, mb: 0.75, mt: 2 }}>{children}</Typography>
);

const RegisterScreen = ({ onBack }) => {
    const [step, setStep] = useState('details'); // 'details' -> 'otp' -> 'done'
    const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [resendIn, setResendIn] = useState(0);

    useEffect(() => {
        if (resendIn <= 0) return undefined;
        const timer = setTimeout(() => setResendIn(s => s - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendIn]);

    const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const sendOtp = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await api.requestRegistrationOtp({ name: form.name.trim(), email: form.email.trim(), password: form.password });
            setInfo(result.message);
            setStep('otp');
            setResendIn(60);
        } catch (err) { setError(err.message); }
        finally { setLoading(false); }
    };

    const handleDetailsSubmit = (e) => {
        e.preventDefault();
        if (!form.email.trim().toLowerCase().endsWith('@srmist.edu.in')) { setError('Please use your official @srmist.edu.in email address.'); return; }
        if (passwordProblem(form.password)) { setError(passwordProblem(form.password)); return; }
        if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
        sendOtp();
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const result = await api.verifyRegistrationOtp(form.email.trim(), otp);
            setInfo(result.message);
            setStep('done');
        } catch (err) { setError(err.message); }
        finally { setLoading(false); }
    };

    const stepIndex = { details: 0, otp: 1, done: 2 }[step];

    return (
        <AuthShell>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 3 }}>
                {['Your details', 'Verify email', 'Approval'].map((label, i) => (
                    <Box key={label} sx={{ flex: 1 }}>
                        <Box sx={{ height: 3, borderRadius: 2, backgroundColor: i <= stepIndex ? tokens.accent : tokens.border }} />
                        <Typography variant="caption" sx={{ color: i <= stepIndex ? tokens.text : tokens.textFaint }}>{label}</Typography>
                    </Box>
                ))}
            </Box>

            {step === 'details' && (
                <Box component="form" onSubmit={handleDetailsSubmit} noValidate>
                    <AuthHeading title="Create your account" subtitle="For SRM faculty. Use your official @srmist.edu.in email; the administrator approves every new account." />
                    <FieldLabel>Full name</FieldLabel>
                    <TextField required fullWidth size="small" name="name" placeholder="Dr. Jane Doe" value={form.name} onChange={handleChange} autoFocus />
                    <FieldLabel>Official email</FieldLabel>
                    <TextField required fullWidth size="small" name="email" type="email" placeholder="name@srmist.edu.in" value={form.email} onChange={handleChange} autoComplete="email" />
                    <FieldLabel>Password</FieldLabel>
                    <TextField required fullWidth size="small" name="password" type="password" placeholder={PASSWORD_RULES} value={form.password} onChange={handleChange} autoComplete="new-password" />
                    <FieldLabel>Confirm password</FieldLabel>
                    <TextField required fullWidth size="small" name="confirmPassword" type="password" value={form.confirmPassword} onChange={handleChange} autoComplete="new-password" />
                    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                    <BusyButton type="submit" fullWidth size="large" variant="contained" sx={{ mt: 3 }} loading={loading} loadingText="Sending code…"
                        disabled={!form.name || !form.email || !form.password || !form.confirmPassword}>
                        Continue
                    </BusyButton>
                </Box>
            )}

            {step === 'otp' && (
                <Box component="form" onSubmit={handleVerify}>
                    <AuthHeading title="Check your inbox" subtitle={info || `We sent a 6-digit code to ${form.email}.`} />
                    <FieldLabel>Verification code</FieldLabel>
                    <TextField
                        required fullWidth autoFocus
                        placeholder="000000"
                        value={otp}
                        onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code', style: { letterSpacing: 12, fontSize: 24, textAlign: 'center', fontFamily: tokens.mono } }}
                    />
                    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                    <BusyButton type="submit" fullWidth size="large" variant="contained" sx={{ mt: 3 }} loading={loading} loadingText="Verifying…" disabled={otp.length !== 6}>
                        Verify email
                    </BusyButton>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5 }}>
                        <Button size="small" onClick={() => { setStep('details'); setError(''); setOtp(''); }}>Change details</Button>
                        <Button size="small" onClick={sendOtp} disabled={loading || resendIn > 0}>
                            {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                        </Button>
                    </Box>
                </Box>
            )}

            {step === 'done' && (
                <Box>
                    <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', mb: 2, backgroundColor: alpha(tokens.accent, 0.12), color: tokens.accent }}>
                        <HourglassTopIcon />
                    </Box>
                    <AuthHeading title="Waiting for approval" subtitle={info} />
                    <Typography variant="body2" color="text.secondary">
                        Once approved, sign in with <strong style={{ color: tokens.text }}>{form.email}</strong> and the password you just created.
                    </Typography>
                </Box>
            )}

            <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 4 }}>
                Already have an account?{' '}
                <Link component="button" type="button" onClick={onBack} sx={{ fontWeight: 500, verticalAlign: 'baseline' }}>Sign in</Link>
            </Typography>
        </AuthShell>
    );
};

const ForgotPasswordScreen = ({ onBack }) => {
    const [step, setStep] = useState('email'); // 'email' -> 'reset' -> 'done'
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const handleRequest = async (e) => {
        e?.preventDefault();
        setLoading(true); setError('');
        try {
            const result = await api.requestPasswordReset(email.trim());
            setInfo(result.message);
            setStep('reset');
        } catch (err) { setError(err.message); }
        finally { setLoading(false); }
    };

    const handleReset = async (e) => {
        e.preventDefault();
        if (passwordProblem(password)) { setError(passwordProblem(password)); return; }
        if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
        setLoading(true); setError('');
        try {
            const result = await api.resetPassword(email.trim(), otp, password);
            setInfo(result.message);
            setStep('done');
        } catch (err) { setError(err.message); }
        finally { setLoading(false); }
    };

    return (
        <AuthShell>
            {step === 'email' && (
                <Box component="form" onSubmit={handleRequest}>
                    <AuthHeading title="Reset your password" subtitle="Enter the email you sign in with. We'll send you a 6-digit code." />
                    <FieldLabel>Email</FieldLabel>
                    <TextField required fullWidth size="small" type="email" placeholder="name@srmist.edu.in" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="email" />
                    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                    <BusyButton type="submit" fullWidth size="large" variant="contained" sx={{ mt: 3 }} loading={loading} loadingText="Sending code…" disabled={!email}>Send reset code</BusyButton>
                </Box>
            )}
            {step === 'reset' && (
                <Box component="form" onSubmit={handleReset}>
                    <AuthHeading title="Choose a new password" subtitle={info} />
                    <FieldLabel>Reset code</FieldLabel>
                    <TextField required fullWidth placeholder="000000" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus
                        inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code', style: { letterSpacing: 12, fontSize: 22, textAlign: 'center', fontFamily: tokens.mono } }} />
                    <FieldLabel>New password</FieldLabel>
                    <TextField required fullWidth size="small" type="password" placeholder={PASSWORD_RULES} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                    <FieldLabel>Confirm new password</FieldLabel>
                    <TextField required fullWidth size="small" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
                    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                    <BusyButton type="submit" fullWidth size="large" variant="contained" sx={{ mt: 3 }} loading={loading} loadingText="Updating…" disabled={otp.length !== 6 || !password}>Update password</BusyButton>
                    <Button size="small" sx={{ mt: 1.5 }} onClick={handleRequest} disabled={loading}>Send a new code</Button>
                </Box>
            )}
            {step === 'done' && (
                <Box>
                    <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>
                    <Button fullWidth size="large" variant="contained" onClick={onBack}>Back to sign in</Button>
                </Box>
            )}
            {step !== 'done' && (
                <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 4 }}>
                    Remembered it? <Link component="button" type="button" onClick={onBack} sx={{ fontWeight: 500, verticalAlign: 'baseline' }}>Sign in</Link>
                </Typography>
            )}
        </AuthShell>
    );
};

const LoginScreen = ({ onLogin, notice }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showRegister, setShowRegister] = useState(false);
    const [showForgot, setShowForgot] = useState(false);
    const handleLogin = async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setLoading(true);
        setError('');
        try {
            const result = await api.login(data.get('email'), data.get('password'));
            onLogin(result.user);
        } catch (err) { setError(err.message); }
        finally { setLoading(false); }
    };
    if (showRegister) return <RegisterScreen onBack={() => setShowRegister(false)} />;
    if (showForgot) return <ForgotPasswordScreen onBack={() => setShowForgot(false)} />;
    return (
        <AuthShell>
            <AuthHeading title="Sign in to MonitorMail" subtitle="Welcome back. Sign in with your faculty account." />
            {notice && <Alert severity="info" sx={{ mb: 1 }}>{notice}</Alert>}
            <Box component="form" onSubmit={handleLogin}>
                <FieldLabel>Email</FieldLabel>
                <TextField required fullWidth size="small" id="email" name="email" placeholder="name@srmist.edu.in" autoComplete="email" autoFocus />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <FieldLabel>Password</FieldLabel>
                    <Link component="button" type="button" variant="body2" onClick={() => setShowForgot(true)} sx={{ fontSize: '0.8125rem' }}>Forgot password?</Link>
                </Box>
                <TextField required fullWidth size="small" name="password" type="password" id="password" autoComplete="current-password" />
                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                <BusyButton type="submit" fullWidth size="large" variant="contained" sx={{ mt: 3 }} loading={loading} loadingText="Signing in…">
                    Sign in
                </BusyButton>
            </Box>
            <Divider sx={{ my: 3, fontSize: 12, color: tokens.textFaint }}>New here?</Divider>
            <Button fullWidth size="large" variant="outlined" onClick={() => setShowRegister(true)}>
                Not registered yet? Create an account
            </Button>
        </AuthShell>
    );
};

// --- Styles for Modals ---
const modalBaseStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  bgcolor: 'background.paper',
  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  p: { xs: 2, sm: 3 },
  borderRadius: 3,
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '90vh',
  outline: 'none',
  border: `1px solid ${tokens.borderStrong}`
};

const emailModalStyle = { ...modalBaseStyle, width: 'calc(100% - 32px)', maxWidth: 1100 };
const massAlertModalStyle = { ...modalBaseStyle, width: 'calc(100% - 32px)', maxWidth: 760, overflowY: 'auto' };


// --- EmailModal (for Workflow) ---
const DEFAULT_BODY = 'Dear [Student Name],\n\nThis is to inform you that your attendance is below the required 75% in the following subject(s):\n\n[Subject List]\n\nPlease attend all classes regularly and meet your Faculty Advisor if you have any concerns.\n\nRegards,\nFaculty Advisor';

const EmailModal = ({ open, onClose, data, onSendAll, onSendSingle, loading, templates, title, setDisplayData, setSnackbar, user, gmailAppPassword, setGmailAppPassword }) => {
    const [emailBodies, setEmailBodies] = useState({});
    const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT);
    const [attachment, setAttachment] = useState(null);
    const [singleSendLoading,
        setSingleSendLoading] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSendingAll, setIsSendingAll] = useState(false);
    const [progress, setProgress] = useState(0);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [sendResults, setSendResults] = useState({}); // reg_no -> { status, reason }

    const generateEmailBody = (templateBody, student) => {
        // [Subject List] = the subjects fetched for this student (only the <75% ones in the low-attendance list)
        const subjects = student?.subjects?.length ? student.subjects : (student?.low_attendance_subjects || []);
        const subjectListText = subjects.length > 0 ? formatSubjectList(subjects) : 'As per the attached/most recent report.';
        const studentName = toTitleCase(student?.name || '') || 'Student';
        const body = typeof templateBody === 'string' ? templateBody : '';

        let processedBody = body.replace(/\[Student Name\]/g, studentName);
        processedBody = processedBody.replace(/\[Subject List\]/g, subjectListText);
        return processedBody;
    };

    const findDefaultTemplate = () =>
        templates.find(t => t.name.toLowerCase().includes('default')) ||
        templates.find(t => t.body.includes('[Subject List]')) ||
        templates[0];

    useEffect(() => {
        if (open) {
            const defaultTemplate = findDefaultTemplate();
            const initialBodies = {};
            if(Array.isArray(data)) {
                data.forEach(student => {
                    if(student && student.reg_no) {
                        initialBodies[student.reg_no] = generateEmailBody(defaultTemplate?.body || DEFAULT_BODY, student);
                    }
                });
            }
            setEmailBodies(initialBodies);
            setSelectedTemplateId(defaultTemplate?.id || '');
            setEmailSubject(DEFAULT_EMAIL_SUBJECT);
            setAttachment(null);
            setSearchQuery('');
            setIsSendingAll(false);
            setProgress(0);
            setSendResults({});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, templates]);

    const handleTemplateChange = (templateId) => {
        setSelectedTemplateId(templateId);
        const template = templates.find(t => t.id === templateId);
        if (template && Array.isArray(data)) {
            const updatedBodies = {};
            data.forEach(student => {
                 if(student && student.reg_no) {
                    updatedBodies[student.reg_no] = generateEmailBody(template.body, student);
                 }
            });
            setEmailBodies(updatedBodies);
        }
    };

    const handleBodyChange = (regNo, value) => setEmailBodies(prev => ({ ...prev, [regNo]: value }));
    const handleAttachmentChange = (e) => setAttachment(e.target.files[0]);

    const buildPayload = (students) => ({
        email_data: students.map(student => ({ ...student, email_body: emailBodies[student.reg_no], subject: emailSubject })),
        gmail_app_password: gmailAppPassword
    });

    const recordResults = (results = []) => {
        setSendResults(prev => {
            const next = { ...prev };
            results.forEach(r => { next[r.reg_no] = { status: r.status, reason: r.reason }; });
            return next;
        });
    };

    const hasRecipient = (student) => Boolean((student.student_email || '').trim() || (student.parent_email || '').trim());

    const handleSendAll = async () => {
        if (!gmailAppPassword.trim()) {
            setSnackbar({ open: true, message: 'Please enter your Gmail app password', severity: 'error' });
            return;
        }
        // Skip students already sent in this session (e.g. when retrying after failures)
        const pending = (Array.isArray(data) ? data : []).filter(s => s && s.reg_no && sendResults[s.reg_no]?.status !== 'success');
        if (pending.length === 0) {
            setSnackbar({ open: true, message: 'All emails in this list have already been sent.', severity: 'info' });
            return;
        }
        setIsSendingAll(true);
        setProgress(0);
        // ~1.5s per email over SMTP; the bar is an estimate until the server responds
        const step = Math.max(1, 90 / pending.length);
        const timer = setInterval(() => { setProgress(p => Math.min(90, p + step)); }, 1500);
        try {
            const result = await onSendAll(buildPayload(pending), attachment);
            recordResults(result?.results);
            setProgress(100);
        } catch (error) {
            setProgress(0);
        } finally {
            clearInterval(timer);
            setIsSendingAll(false);
        }
    };

    const handleSendSingle = async (student) => {
        if(!student || !student.reg_no) return;
        if (!gmailAppPassword.trim()) {
            setSnackbar({ open: true, message: 'Please enter your Gmail app password', severity: 'error' });
            return;
        }
        setSingleSendLoading(student.reg_no);
        const result = await onSendSingle(buildPayload([student]), attachment, student.reg_no);
        recordResults(result?.results);
        setSingleSendLoading(null);
    };

    const filteredData = Array.isArray(data) ? data.filter(student => {
        if (!student || !student.reg_no) return false;
        const q = searchQuery.toLowerCase();
        return student.reg_no.toLowerCase().includes(q) || (student.name || '').toLowerCase().includes(q);
    }) : [];

    const sentCount = Object.values(sendResults).filter(r => r.status === 'success').length;
    const failedCount = Object.values(sendResults).filter(r => r.status !== 'success').length;
    const noEmailCount = (Array.isArray(data) ? data : []).filter(s => s && !hasRecipient(s)).length;

    return (
        <Modal
            open={open}
            onClose={isSendingAll ? undefined : onClose}
            closeAfterTransition
        >
            <Fade in={open}>
                <Box sx={emailModalStyle}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Box>
                            <Typography variant="h6">{title || 'Review & send emails'}</Typography>
                            <Typography variant="body2" color="text.secondary">{Array.isArray(data) ? data.length : 0} student(s) · sending as {user?.email}</Typography>
                        </Box>
                        <IconButton onClick={onClose} disabled={isSendingAll}><CloseIcon /></IconButton>
                    </Box>

                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <GmailAppPasswordField value={gmailAppPassword} onChange={setGmailAppPassword} disabled={isSendingAll} senderEmail={user?.email} />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                                <InputLabel>Template</InputLabel>
                                <Select label="Template" value={selectedTemplateId} onChange={e => handleTemplateChange(e.target.value)} disabled={isSendingAll}>
                                    {templates.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <TextField fullWidth size="small" label="Email subject" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} disabled={isSendingAll} />
                        </Grid>
                    </Grid>

                    {noEmailCount > 0 && (
                        <Alert severity="warning" sx={{ mb: 2 }}>{noEmailCount} student(s) have no email address and will be skipped. Add an email below to include them.</Alert>
                    )}
                    {(sentCount > 0 || failedCount > 0) && !isSendingAll && (
                        <Alert severity={failedCount ? 'warning' : 'success'} sx={{ mb: 2 }}>
                            {sentCount} email(s) sent{failedCount ? `, ${failedCount} failed — fix the details and click "Send All" again to retry only those.` : '. A delivery summary was sent to your inbox.'}
                        </Alert>
                    )}

                    <TextField fullWidth placeholder="Search by name or registration no." variant="outlined" size="small" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} sx={{ mb: 2 }} disabled={isSendingAll} />
                    <Box sx={{ overflowY: 'auto', flexGrow: 1, p: 1 }}>
                        {filteredData.map(student => {
                            const result = sendResults[student.reg_no];
                            const lowSubjects = student.low_attendance_subjects || [];
                            return (
                                <Paper key={student.reg_no} variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, borderColor: result ? (result.status === 'success' ? 'success.main' : 'error.main') : undefined }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                                        <Box>
                                            <Typography variant="subtitle1" fontWeight="bold">{toTitleCase(student.name || '') || 'Unknown'} ({student.reg_no})</Typography>
                                            {student.missing && <Typography variant="body2" color="warning.main">Not in the student database — enter the emails, then save to add them.</Typography>}
                                        </Box>
                                        {result && (
                                            <Chip size="small" color={result.status === 'success' ? 'success' : 'error'} label={result.status === 'success' ? 'Sent' : `Failed: ${result.reason || 'unknown error'}`} />
                                        )}
                                    </Box>
                                    {lowSubjects.length > 0 && (
                                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                                            {lowSubjects.map((s, i) => (
                                                <Chip key={i} size="small" variant="outlined" color={s.Percentage < 50 ? 'error' : 'warning'} label={`${s.Subject}: ${Number(s.Percentage).toFixed(2)}%`} />
                                            ))}
                                        </Stack>
                                    )}

                                    <Grid container spacing={2} sx={{ mt: 0, mb: 1 }}>
                                        {student.missing && (
                                            <Grid size={{ xs: 12, sm: 4 }}>
                                                <TextField
                                                    fullWidth size="small"
                                                    label="Name"
                                                    value={student.name || ''}
                                                    onChange={e => {
                                                        const value = e.target.value;
                                                        setDisplayData(prev => prev.map(item => item.reg_no === student.reg_no ? { ...item, name: value } : item));
                                                    }}
                                                    disabled={isSendingAll}
                                                />
                                            </Grid>
                                        )}
                                        <Grid size={{ xs: 12, sm: student.missing ? 4 : 6 }}>
                                            <TextField
                                                fullWidth size="small"
                                                label="Student email"
                                                value={student.student_email || ''}
                                                onChange={e => {
                                                    const value = e.target.value;
                                                    setDisplayData(prev => prev.map(item => item.reg_no === student.reg_no ? { ...item, student_email: value } : item));
                                                }}
                                                disabled={isSendingAll}
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: student.missing ? 4 : 6 }}>
                                            <TextField
                                                fullWidth size="small"
                                                label="Parent email (CC)"
                                                value={student.parent_email || ''}
                                                onChange={e => {
                                                    const value = e.target.value;
                                                    setDisplayData(prev => prev.map(item => item.reg_no === student.reg_no ? { ...item, parent_email: value } : item));
                                                }}
                                                disabled={isSendingAll}
                                            />
                                        </Grid>
                                    </Grid>

                                    <TextField multiline fullWidth rows={6} value={emailBodies[student.reg_no] || ''} onChange={e => handleBodyChange(student.reg_no, e.target.value)} InputProps={{ sx: { fontFamily: tokens.mono, fontSize: '0.8125rem' } }} disabled={isSendingAll}/>

                                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                        <BusyButton variant="outlined" size="small" startIcon={<SendIcon />} loading={singleSendLoading === student.reg_no} disabled={isSendingAll || !hasRecipient(student)} onClick={() => handleSendSingle(student)}>
                                            {result?.status === 'success' ? 'Send again' : 'Send only this one'}
                                        </BusyButton>
                                        {student.missing && (
                                            <Button
                                                size="small"
                                                variant="text"
                                                onClick={async () => {
                                                    try {
                                                        const payload = {
                                                            reg_no: student.reg_no,
                                                            name: (student.name || '').toUpperCase(),
                                                            section: student.section || '',
                                                            department: student.department || '',
                                                            phone_number: student.phone_number || '',
                                                            email: student.student_email,
                                                            parent_mobile: student.parent_mobile || '',
                                                            parent_email: student.parent_email
                                                        };
                                                        const res = await api.saveStudent(payload);
                                                        setSnackbar({ open: true, message: 'Student added to the database!', severity: 'success' });
                                                        setDisplayData(prev => prev.map(item => item.reg_no === student.reg_no ? { ...item, missing: false, id: res.id } : item));
                                                    } catch (err) {
                                                        setSnackbar({ open: true, message: `Save failed: ${err.message}`, severity: 'error' });
                                                    }
                                                }}
                                                disabled={!student.name || !student.student_email || isSendingAll}
                                            >
                                                Save to database
                                            </Button>
                                        )}
                                    </Box>
                                </Paper>
                            );
                        })}
                         {filteredData.length === 0 &&
                            <Typography color="text.secondary" align="center">No students match your search.</Typography>}
                    </Box>
                    {isSendingAll && (<Box sx={{ width: '100%', my: 2 }}><LinearProgress variant="determinate" value={progress} /><Typography variant="body2" color="text.secondary" align="center" sx={{mt: 1}}>Sending emails… keep this window open ({`${Math.round(progress)}%`})</Typography></Box>)}

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, gap: 2, flexWrap: 'wrap' }}>
                        <Button variant="outlined" component="label" startIcon={<AttachmentIcon />} disabled={isSendingAll}>Attach file<input type="file" hidden onChange={handleAttachmentChange} /></Button>
                        {attachment && <Typography variant="body2" noWrap sx={{maxWidth: '200px'}}>{attachment.name}</Typography>}
                        <Box flexGrow={1} />
                        {sentCount > 0 && !isSendingAll && <Button variant="outlined" onClick={onClose}>Done</Button>}
                        <BusyButton onClick={handleSendAll} variant="contained" startIcon={<SendIcon />} loading={isSendingAll} loadingText="Sending…" disabled={loading || !gmailAppPassword.trim() || filteredData.length === 0}>
                            {failedCount > 0 ? 'Retry failed / unsent' : 'Send all emails'}
                        </BusyButton>
                    </Box>
                </Box>
            </Fade>
        </Modal>
    );
};

// --- Mass Alert Modal ---
const MassAlertModal = ({ open, onClose, onSend, loading, templates, user, gmailAppPassword, setGmailAppPassword }) => {
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [attachment, setAttachment] = useState(null);

    useEffect(() => {
        if (open) {
            setSubject('');
            setBody('');
            setAttachment(null);
        }
    }, [open]);

    const handleTemplateChange = (templateId) => {
        const template = templates.find(t => t.id === templateId);
        if (template) {
            setBody(template.body);
        }
    };

    const handleAttachmentChange = (e) => setAttachment(e.target.files[0]);

    const handleSend = () => {
        onSend({ subject: subject, email_body: body, gmail_app_password: gmailAppPassword }, attachment);
    };

    return (
        <Modal open={open} onClose={onClose} closeAfterTransition>
            <Fade in={open}>
                <Box sx={massAlertModalStyle}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Box>
                            <Typography variant="h6">Mass alert</Typography>
                            <Typography variant="body2" color="text.secondary">Goes to every student in the database, parents in CC.</Typography>
                        </Box>
                        <IconButton
                            onClick={onClose}><CloseIcon /></IconButton>
                    </Box>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                            <GmailAppPasswordField value={gmailAppPassword} onChange={setGmailAppPassword} disabled={loading} senderEmail={user?.email} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField fullWidth label="Subject"
                                value={subject} onChange={e => setSubject(e.target.value)} disabled={loading} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Template</InputLabel>
                                <Select label="Template" onChange={e => handleTemplateChange(e.target.value)} defaultValue="" disabled={loading}>
                                    {templates.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField fullWidth multiline rows={10} label="Message" value={body} onChange={e => setBody(e.target.value)} InputProps={{ sx: { fontFamily: tokens.mono, fontSize: '0.8125rem' } }} helperText="Use [Student Name] as a placeholder for personalization." disabled={loading} />
                        </Grid>
                    </Grid>

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, gap: 2, flexWrap: 'wrap' }}>
                        <Button variant="outlined" component="label" startIcon={<AttachmentIcon />} disabled={loading}>
                            Attach file
                            <input type="file" hidden onChange={handleAttachmentChange} />
                        </Button>
                        {attachment && <Typography variant="body2" noWrap sx={{maxWidth: '200px'}}>{attachment.name}</Typography>}
                        <Box flexGrow={1} />
                        <BusyButton onClick={handleSend} variant="contained" startIcon={<SendIcon />} loading={loading} loadingText="Sending…" disabled={!subject || !body || !gmailAppPassword.trim()}>
                            Send to all students
                        </BusyButton>
                    </Box>
                </Box>
            </Fade>
        </Modal>
    );
};


// --- Student import (CSV / Excel) ---
const SAMPLE_IMPORT_CSV = 'Reg.No,Name,Section,Department,Phone,Email,Parent Mobile,Parent Email\nRA2311003010001,ADITYA RAJ,A1,CSE,9876543210,ar1234@srmist.edu.in,9876500000,parent@gmail.com\n';

const ImportStudentsDialog = ({ open, onClose, onImported }) => {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [fileName, setFileName] = useState('');
    useEffect(() => { if (open) { setResult(null); setError(''); setFileName(''); } }, [open]);

    const handleFile = async (file) => {
        setFileName(file.name); setBusy(true); setError(''); setResult(null);
        try {
            const res = await api.importStudents(file);
            setResult(res);
            onImported?.(res);
        } catch (err) { setError(err.message); }
        finally { setBusy(false); }
    };

    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>Import students</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Upload a CSV or Excel sheet. Students are matched on <Mono>Reg.No</Mono>: new ones are added, existing ones get their details updated (blank cells are ignored).
                </Typography>
                <Dropzone onFile={handleFile} busy={busy} fileName={fileName} accept=".csv,.xlsx,.xls" title={<>Drop a .csv or .xlsx file or <Box component="span" sx={{ color: tokens.accent }}>browse</Box></>}
                    hint="Columns: Reg.No, Name, Section, Department, Phone, Email, Parent Mobile, Parent Email" />
                <Button size="small" startIcon={<FileDownloadOutlinedIcon />} sx={{ mt: 1.5 }}
                    onClick={() => api.downloadBlob(new Blob([SAMPLE_IMPORT_CSV], { type: 'text/csv' }), 'students_template.csv')}>
                    Download sample CSV
                </Button>
                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                {result && (
                    <Alert severity={result.skipped.length ? 'warning' : 'success'} sx={{ mt: 2, alignItems: 'flex-start' }}>
                        <strong>{result.created}</strong> added, <strong>{result.updated}</strong> updated{result.skipped.length ? <>, <strong>{result.skipped.length}</strong> skipped</> : ''}.
                        {result.skipped.length > 0 && (
                            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                                {result.skipped.slice(0, 5).map(s => <li key={s.row}>Row {s.row}{s.reg_no ? ` (${s.reg_no})` : ''}: {s.reason}</li>)}
                                {result.skipped.length > 5 && <li>…and {result.skipped.length - 5} more</li>}
                            </Box>
                        )}
                    </Alert>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button variant="outlined" onClick={onClose} disabled={busy}>{result ? 'Done' : 'Cancel'}</Button>
            </DialogActions>
        </Dialog>
    );
};

// --- MAIN APP COMPONENT ---
function App() {
    // The session is an HttpOnly cookie; the browser only learns who is signed in by asking the server
    const [user, setUser] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);
    const token = Boolean(user);
    const [loading, setLoading] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, 
        message: '', severity: 'info' });
    const [view, setView] = useState('dashboard');
    
    // Workflow state
    const [file, setFile] = useState(null);
    const [intermediateCsv, setIntermediateCsv] = useState(''); 
    const [displayData, setDisplayData] = useState([]); 
    const [isProcessingPdf, setIsProcessingPdf] = useState(false);
    const [isFetchingDetails, setIsFetchingDetails] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [showManualAdd, setShowManualAdd] = useState(false);
    const [expandedHistoryId, setExpandedHistoryId] = useState(null);
    const [confirmState, setConfirmState] = useState({ open: false });
    const [importOpen, setImportOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [sessionNotice, setSessionNotice] = useState('');
    const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [auditLog, setAuditLog] = useState([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const fetchAuditLog = useCallback(async () => {
        setAuditLoading(true);
        try { setAuditLog(await api.getAuditLog()); }
        catch (err) { setSnackbar({ open: true, message: `Failed to load the security log: ${err.message}`, severity: 'error' }); }
        finally { setAuditLoading(false); }
    }, []);
    const askConfirm = (options) => setConfirmState({ ...options, open: true });
    const [pdfSummary, setPdfSummary] = useState(null);
    const [listMode, setListMode] = useState(''); // 'low' | 'all'
    // Gmail app password is kept in memory only (cleared on logout / refresh)
    const [gmailAppPassword, setGmailAppPassword] = useState('');
    // manual entry fields for new feature
    const [manualRegNo, setManualRegNo] = useState('');
    const [manualName, setManualName] = useState('');
    const [manualStudentEmail, setManualStudentEmail] = useState('');
    const [manualParentEmail, setManualParentEmail] = useState('');

    // Templates state
    const [templates, setTemplates] = useState([]);
    const [templateModalOpen, setTemplateModalOpen] = useState(false);
    const [currentTemplate, setCurrentTemplate] = useState({ id: null, name: '', body: '' });

    // History state
    const [history, setHistory] = useState([]);
    const [historySearch, setHistorySearch] = useState('');

    // Dashboard state
    const [analytics, setAnalytics] = useState(null);

    // Teacher Management state
   
    const [teachers, setTeachers] = useState([]);
    const [pendingTeachers, setPendingTeachers] = useState([]);
    const [reviewingId, setReviewingId] = useState(null);
    
    // Student Management state
    const [students, setStudents] = useState([]);
    const [managementSearch, setManagementSearch] = useState('');
    const [editModalOpen, setEditModalOpen] = useState(false); 
    const [currentItem, setCurrentItem] = useState(null); 
    const [modalType, setModalType] = useState(''); // 'teacher' or 'student'
    
    // Alert tab state
    const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
    const [isSendingAlert, setIsSendingAlert] = useState(false);

    // Monitor tab state (Phase 1)
    const [monitors, setMonitors] = useState([]);
    const [monitorLoading, setMonitorLoading] = useState(false);
    const [monitorMatches, setMonitorMatches] = useState([]);
    const [selectedMonitorId, setSelectedMonitorId] = useState(null);
    const [newMonitor, setNewMonitor] = useState({
        name: 'My Monitor',
        imap_host: 'imap.gmail.com',
        imap_port: 993,
        username: '',
        password: '',
        folder: 'INBOX',
        subject_contains: '',
        interval_seconds: 60
    });
    const [isCreatingMonitor, setIsCreatingMonitor] = useState(false);

    // --- DATA FETCHING ---
    const fetchAnalytics = 
        useCallback(async () => { try { const data = await api.getDashboardAnalytics(); setAnalytics(data); } catch (err) { setSnackbar({ open: true, message: `Failed to fetch analytics: ${err.message}`, severity: 'error' }); } }, []);
    const fetchTemplates = useCallback(async () => { try { const data = await api.getTemplates(); setTemplates(data); } catch (err) { setSnackbar({ open: true, message: `Failed to fetch templates: ${err.message}`, severity: 'error' }); } }, []);
    const fetchHistory = useCallback(async (search = historySearch) => { try { const 
        data = await api.getHistory(search); setHistory(data); } catch (err) { setSnackbar({ open: true, message: `Failed to fetch history: ${err.message}`, severity: 'error' }); } }, [historySearch]);
    const fetchTeachers = useCallback(async () => { try { const data = await api.getTeachers(); setTeachers(data); } catch (err) { setSnackbar({ open: true, message: `Failed to fetch teachers: ${err.message}`, severity: 'error' }); } }, []);
    const fetchPendingTeachers = useCallback(async () => { try { const data = await api.getPendingTeachers(); setPendingTeachers(data); } catch (err) { setSnackbar({ open: true, message: `Failed to fetch registrations: ${err.message}`, severity: 'error' }); } }, []);
    const fetchStudents = useCallback(async (search = managementSearch) => { 
        setLoading(true); 
 
        try { 
            const data = await api.getStudents(search); 
            setStudents(data); 
        } catch (err) { 
            setSnackbar({ open: true, message: `Failed to fetch students: ${err.message}`, severity: 'error' }); 
  
        } finally {
            setLoading(false);
        }
    }, [managementSearch]); 

    const fetchMonitors = useCallback(async () => {
        setMonitorLoading(true);
        try {
            const data = await api.listMonitors();
            setMonitors(data);
        } catch (err) {
            setSnackbar({ open: true, message: `Failed to fetch monitors: ${err.message}`, severity: 'error' });
        } finally {
            setMonitorLoading(false);
        }
    }, []);

    const fetchMonitorMatches = useCallback(async (monitorId) => {
        if (!monitorId) return;
        try {
            const data = await api.getMonitorMatches(monitorId);
            setMonitorMatches(data);
        } catch (err) {
            setSnackbar({ open: true, message: `Failed to fetch matches: ${err.message}`, severity: 'error' });
        }
    }, []);

    useEffect(() => {
        if (token) {
            if (view === 'templates' || view === 'alert' || view === 'workflow') fetchTemplates();
            if (view === 'dashboard') fetchAnalytics();
            if (view === 'history') fetchHistory();
            if (view === 'teachers') fetchTeachers();
            if (user?.is_admin) fetchPendingTeachers();
            if (view === 'students') fetchStudents(managementSearch);
            if (view === 'monitor') fetchMonitors();
            if (view === 'security' && user?.is_admin) fetchAuditLog();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, token, user?.is_admin, fetchAnalytics, fetchTemplates, fetchTeachers, fetchStudents, 
        managementSearch, fetchMonitors, fetchPendingTeachers]); 

    useEffect(() => {
        if (selectedMonitorId) {
            fetchMonitorMatches(selectedMonitorId);
        } else {
            setMonitorMatches([]);
        }
    }, [selectedMonitorId, fetchMonitorMatches]);

    // --- HANDLERS ---
    const handleLogin = (signedInUser) => { setSessionNotice(''); setUser(signedInUser); };
    const resetSessionState = () => { setUser(null); setView('dashboard'); setGmailAppPassword(''); setDisplayData([]); setIntermediateCsv(''); setPdfSummary(null); setFile(null); };
    const handleLogout = () => { api.logout().catch(() => {}); resetSessionState(); };

    useEffect(() => {
        api.me().then(res => setUser(res.user)).catch(() => setUser(null)).finally(() => setAuthChecked(true));
    }, []);

    // Sign out automatically when the login token expires
    useEffect(() => {
        const onExpired = () => { resetSessionState(); setSessionNotice('Your session expired. Please sign in again.'); };
        window.addEventListener('mm:session-expired', onExpired);
        return () => window.removeEventListener('mm:session-expired', onExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleExportExcel = async () => {
        setIsExporting(true);
        try {
            const blob = await api.exportStructuredExcel(displayData);
            api.downloadBlob(blob, `Low_Attendance_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (err) {
            setSnackbar({ open: true, message: `Export failed: ${err.message}`, severity: 'error' });
        } finally { setIsExporting(false); }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (passwordProblem(passwordForm.next)) { setSnackbar({ open: true, message: passwordProblem(passwordForm.next), severity: 'error' }); return; }
        if (passwordForm.next !== passwordForm.confirm) { setSnackbar({ open: true, message: 'New passwords do not match.', severity: 'error' }); return; }
        setIsChangingPassword(true);
        try {
            const result = await api.changePassword(passwordForm.current, passwordForm.next);
            setPasswordForm({ current: '', next: '', confirm: '' });
            setSnackbar({ open: true, message: result.message, severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message, severity: 'error' });
        } finally { setIsChangingPassword(false); }
    };

    // Approval handlers (admin)
    const handleReviewTeacher = async (teacher, approve) => {
        setReviewingId(teacher.id);
        try {
            const result = approve ? await api.approveTeacher(teacher.id) : await api.rejectTeacher(teacher.id);
            const note = result.email_sent ? ' They have been notified by email.' : ' (Notification email could not be sent.)';
            setSnackbar({ open: true, message: `${teacher.name} ${approve ? 'approved' : 'rejected'}.${note}`, severity: approve ? 'success' : 'info' });
            fetchPendingTeachers();
            if (view === 'teachers') fetchTeachers();
        } catch (err) {
            setSnackbar({ open: true, message: `Action failed: ${err.message}`, severity: 'error' });
        } finally {
            setReviewingId(null);
        }
    };

    // Monitor handlers
    const handleMonitorFieldChange = (e) => {
        const { name, value } = e.target;
        setNewMonitor(prev => ({ ...prev, [name]: value }));
    };

    const handleCreateMonitor = async () => {
        setIsCreatingMonitor(true);
        try {
            const created = await api.createMonitor(newMonitor);
            setSnackbar({ open: true, message: 'Monitor created successfully.', severity: 'success' });
            setNewMonitor({
                name: 'My Monitor',
                imap_host: 'imap.gmail.com',
                imap_port: 993,
                username: '',
                password: '',
                folder: 'INBOX',
                subject_contains: '',
                interval_seconds: 60
            });
            await fetchMonitors();
            setSelectedMonitorId(created.id);
        } catch (err) {
            setSnackbar({ open: true, message: `Failed to create monitor: ${err.message}`, severity: 'error' });
        } finally {
            setIsCreatingMonitor(false);
        }
    };

    const handleDeleteMonitor = (id) => askConfirm({ title: 'Delete monitor?', message: 'It stops checking the inbox and its matches are removed.', confirmLabel: 'Delete', danger: true, onConfirm: () => deleteMonitor(id) });
    const deleteMonitor = async (id) => {
        try {
            await api.deleteMonitor(id);
            setSnackbar({ open: true, message: 'Monitor deleted.', severity: 'info' });
            if (selectedMonitorId === id) setSelectedMonitorId(null);
            await fetchMonitors();
        } catch (err) {
            setSnackbar({ open: true, message: `Delete failed: ${err.message}`, severity: 'error' });
        }
    };

    const handleSelectMonitor = (id) => {
        setSelectedMonitorId(id);
    };

    // Workflow handlers
    const handleListLow = async (csvData = intermediateCsv) => {
        if (!csvData) return;
        setIsFetchingDetails(true);
        try {
            const sortResult = await api.sortAttendance(csvData);
            setListMode('low');
            if (!sortResult.summary.total_students_with_low_attendance) {
                setDisplayData([]);
                setSnackbar({ open: true, message: `No students are below ${ATTENDANCE_THRESHOLD}% attendance.`, severity: 'info' });
                return;
            }
            if (templates.length === 0) await fetchTemplates();
            const fetchResult = await api.fetchStudentDetails(sortResult.sorted_csv_data);
            setDisplayData(fetchResult);
            const missing = fetchResult.filter(s => s.missing).length;
            if (missing) setSnackbar({ open: true, message: `${missing} student(s) are not in the database. Add their emails before sending.`, severity: 'warning' });
        } catch (err) { setSnackbar({ open: true, message: `Fetch Error: ${err.message}`, severity: 'error' }); }
        finally { setIsFetchingDetails(false); }
    };
    const handleListAll = async () => {
        if (!intermediateCsv) return;
        setIsFetchingDetails(true);
        try {
            if (templates.length === 0) await fetchTemplates();
            const result = await api.fetchStudentDetails(intermediateCsv);
            setListMode('all');
            setDisplayData(result);
            if (result.length === 0) setSnackbar({ open: true, message: 'No student details found.', severity: 'warning' });
        } catch (err) { setSnackbar({ open: true, message: `Fetch Error: ${err.message}`, severity: 'error' }); }
        finally { setIsFetchingDetails(false); }
    };
    const processPdf = async (selectedFile) => {
        if (!selectedFile) return;
        setIsProcessingPdf(true);
        setIntermediateCsv(''); setDisplayData([]); setPdfSummary(null); setListMode('');
        setSnackbar({ open: false, message: '' });
        try {
            const result = await api.uploadPdf(selectedFile);
            setIntermediateCsv(result.csv_data);
            setPdfSummary(result.summary);
            setIsProcessingPdf(false);
            // Go straight to the low-attendance list: that's who gets notified
            await handleListLow(result.csv_data);
        } catch (err) { setSnackbar({ open: true, message: `PDF Error: ${err.message}`, severity: 'error' }); }
        finally { setIsProcessingPdf(false); }
    };
    
    // manual entry helpers
    const handleAddManualStudent = () => {
        if (!manualRegNo) return;
        const newEntry = {
            reg_no: manualRegNo,
            name: manualName || '',
            student_email: manualStudentEmail || '',
            parent_email: manualParentEmail || '',
            subjects: []
        };
        setDisplayData(prev => [...prev, newEntry]);
        // clear input fields
        setManualRegNo('');
        setManualName('');
        setManualStudentEmail('');
        setManualParentEmail('');
    };

    const handleRemoveStudentRow = (index) => {
        setDisplayData(prev => prev.filter((_, i) => i !== index));
    };

    const handleClearDisplay = () => {
        setDisplayData([]);
    };

    // Alert Tab Handler
    const handleSendMassAlert = async (payload, attachment) => {
       
        setIsSendingAlert(true);
        setSnackbar({ open: false, message: '' });
        try {
            const result = await api.sendMassAlert(payload, attachment);
            setSnackbar({ open: true, message: `Mass alert sent! ${result.results.success_count} succeeded, ${result.results.fail_count} failed.`, severity: 'success' });
            setIsAlertModalOpen(false);
            fetchAnalytics(); 
        } catch (err) {
            setSnackbar({ open: true, message: `Alert Failed: ${err.message}`, severity: 'error' });
        } finally {
       
            setIsSendingAlert(false);
        }
    };
    
    // Email handlers (for Workflow) - return the server result so the modal can show per-student status
    const handleSendAllEmails = async (payload, attachment) => {
        setLoading(true);
        try {
            const result = await api.sendEmails(payload, attachment);
            const severity = result.failed_count ? 'warning' : 'success';
            setSnackbar({ open: true, message: `${result.sent_count} email(s) sent${result.failed_count ? `, ${result.failed_count} failed` : ''}.`, severity });
            fetchAnalytics();
            return result;
        } catch (err) {
            setSnackbar({ open: true, message: err.message, severity: 'error' });
            throw err;
        } finally { setLoading(false); }
    };
    const handleSendSingleEmail = async (payload, attachment, regNo) => {
        try {
            const result = await api.sendEmails(payload, attachment);
            if (result.success && result.results[0]?.status === 'success') {
                setSnackbar({ open: true, message: `Email sent to ${regNo}.`, severity: 'success' });
                fetchAnalytics();
            } else {
                const reason = result.results[0]?.reason || result.error;
                setSnackbar({ open: true, message: `Failed to send to ${regNo}: ${reason}`, severity: 'error' });
            }
            return result;
        } catch (err) {
            setSnackbar({ open: true, message: `Failed to send to ${regNo}: ${err.message}`, severity: 'error' });
            return null;
        }
    };

   
    const handleDeleteTemplate = (template) => askConfirm({
        title: 'Delete template?', message: `"${template.name}" will be deleted permanently.`, confirmLabel: 'Delete', danger: true,
        onConfirm: async () => { try { await api.deleteTemplate(template.id); fetchTemplates(); setSnackbar({ open: true, message: 'Template deleted.', severity: 'info' }); } catch (err) { setSnackbar({ open: true, message: `Delete failed: ${err.message}`, severity: 'error' }); } }
    });
   const handleSaveTemplate = async () => { try { await api.saveTemplate(currentTemplate); setTemplateModalOpen(false); fetchTemplates(); setSnackbar({ open: true, message: 'Template saved!', severity: 'success' }); } catch (err) { setSnackbar({ open: true, message: `Save failed: ${err.message}`, severity: 'error' }); } };
    
    // Management Handlers for Both Types
    const handleOpenEditModal = (item, type) => { 
        setCurrentItem({ ...item }); 
        setModalType(type); 
        setEditModalOpen(true); 
    };
    
    const handleSaveItem = async () => { 
   
        setLoading(true); 
        try {
            if (modalType === 'teacher') {
                await api.saveTeacher(currentItem);
                fetchTeachers();
            } else if (modalType === 'student') {
                await api.saveStudent(currentItem);
                fetchStudents(managementSearch);
            }
          
            setEditModalOpen(false);
            setSnackbar({ open: true, message: `${modalType === 'teacher' ? 'Teacher' : 'Student'} saved.`, severity: 'success' }); 
        } catch (err) { 
            setSnackbar({ open: true, message: `Save failed: ${err.message}`, severity: 'error' }); 
        } finally {
            setLoading(false);
        }
    };
    
    const handleDeleteTeacher = (teacher) => askConfirm({
        title: 'Delete teacher?', message: `${teacher.name} (${teacher.email}) will no longer be able to sign in.`, confirmLabel: 'Delete', danger: true,
        onConfirm: async () => { try { await api.deleteTeacher(teacher.id); fetchTeachers(); setSnackbar({ open: true, message: 'Teacher deleted.', severity: 'info' }); } catch (err) { setSnackbar({ open: true, message: `Delete failed: ${err.message}`, severity: 'error' }); } }
    });

    const handleDeleteStudent = (student) => askConfirm({
        title: 'Delete student?', message: `${toTitleCase(student.name || '')} (${student.reg_no}) will be removed from the database.`, confirmLabel: 'Delete', danger: true,
        onConfirm: async () => { try { await api.deleteStudent(student.id); fetchStudents(managementSearch); setSnackbar({ open: true, message: 'Student deleted.', severity: 'info' }); } catch (err) { setSnackbar({ open: true, message: `Delete failed: ${err.message}`, severity: 'error' }); } }
    });

    const handleItemChange = (e) => { const { name, value, type, checked } = e.target; setCurrentItem(prev => 
        ({ ...prev, [name]: type === 'checkbox' ? checked : value })); };

    if (!authChecked) {
        return <ThemeProvider theme={theme}><CssBaseline /><Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box></ThemeProvider>;
    }
    if (!token) { return <ThemeProvider theme={theme}><CssBaseline /><LoginScreen onLogin={handleLogin} notice={sessionNotice} /></ThemeProvider>; }

    const navGroups = [
        { label: 'Workspace', items: [
            { value: 'dashboard', label: 'Overview', icon: <SpaceDashboardOutlinedIcon /> },
            { value: 'workflow', label: 'Low Attendance', icon: <FactCheckOutlinedIcon /> },
            { value: 'alert', label: 'Mass Alert', icon: <CampaignOutlinedIcon /> },
            { value: 'templates', label: 'Templates', icon: <ArticleOutlinedIcon /> },
            { value: 'history', label: 'History', icon: <HistoryIcon /> },
        ] },
        { label: 'Directory', items: [
            { value: 'students', label: 'Students', icon: <SchoolOutlinedIcon /> },
            ...(user.is_admin ? [
                { value: 'teachers', label: 'Teachers', icon: <GroupOutlinedIcon /> },
                { value: 'approvals', label: 'Approvals', icon: <HowToRegOutlinedIcon />, badge: pendingTeachers.length },
                { value: 'security', label: 'Security log', icon: <ShieldOutlinedIcon /> },
            ] : []),
        ] },
        { label: 'Tools', items: [
            { value: 'monitor', label: 'Mail Monitor', icon: <MarkEmailReadOutlinedIcon /> },
            { value: 'account', label: 'Account', icon: <ManageAccountsOutlinedIcon /> },
        ] },
    ];

    const firstName = (user?.name || '').split(' ')[0] || 'there';
    const lowCount = displayData.filter(s => (s.low_attendance_subjects || []).length > 0).length;
    const missingCount = displayData.filter(s => s.missing).length;
    const busyWorkflow = isProcessingPdf || isFetchingDetails;

    // --- RENDER ---
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <AppShell navGroups={navGroups} view={view} onNavigate={setView} user={user} onLogout={handleLogout}>

                {view === 'dashboard' && (
                    <>
                        <PageHeader
                            eyebrow="Overview"
                            title={`Welcome back, ${firstName}`}
                            description="Upload the latest attendance report to notify every student below 75%, or send an announcement to all students."
                            actions={<>
                                <Button variant="outlined" startIcon={<CampaignOutlinedIcon />} onClick={() => setView('alert')}>Mass alert</Button>
                                <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => setView('workflow')}>Upload attendance PDF</Button>
                            </>}
                        />

                        {user.is_admin && pendingTeachers.length > 0 && (
                            <Alert severity="warning" sx={{ mb: 3 }} action={<Button size="small" variant="outlined" onClick={() => setView('approvals')}>Review</Button>}>
                                {pendingTeachers.length} teacher registration{pendingTeachers.length > 1 ? 's are' : ' is'} waiting for your approval.
                            </Alert>
                        )}

                        {analytics ? (
                            <>
                                <Grid container spacing={2} sx={{ mb: 3 }}>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label="Emails sent today" value={analytics.emails_sent_today} hint={`${analytics.unique_students_contacted} student(s)`} icon={<SendIcon fontSize="small" />} /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label="Last 7 days" value={analytics.emails_this_week} hint="emails, all teachers" icon={<BarChartIcon fontSize="small" />} accent={tokens.info} /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label="Sent by you" value={analytics.my_emails_total} hint={analytics.my_last_sent_at ? `Last: ${timeAgo(analytics.my_last_sent_at)}` : 'No emails yet'} icon={<MailOutlineIcon fontSize="small" />} accent={tokens.warning} /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label="Students in database" value={Number(analytics.student_count).toLocaleString()} hint={`${analytics.students_contacted_total} contacted so far`} icon={<PeopleIcon fontSize="small" />} accent="#b18cff" /></Grid>
                                </Grid>

                                <Grid container spacing={3}>
                                    <Grid size={{ xs: 12, md: 7 }}>
                                        <Section title="Emails sent" description="All teachers, last 14 days" sx={{ mb: 3 }}>
                                            <ActivityChart data={analytics.daily} />
                                        </Section>
                                        <Section title="Most notified students" description="Students who received the most emails overall." contentSx={{ p: 0 }} sx={{ mb: 0 }}>
                                            {analytics.top_students.length === 0 ? (
                                                <EmptyState icon={<MailOutlineIcon />} title="No emails sent yet" description="Students you notify will show up here." />
                                            ) : (
                                                <Table size="small">
                                                    <TableHead><TableRow><TableCell>Student</TableCell><TableCell>Last emailed</TableCell><TableCell align="right">Emails</TableCell></TableRow></TableHead>
                                                    <TableBody>
                                                        {analytics.top_students.map(s => (
                                                            <TableRow key={s.reg_no} hover>
                                                                <TableCell><Typography variant="body2" sx={{ fontWeight: 500 }}>{toTitleCase(s.name || '')}</Typography><Mono sx={{ color: tokens.textFaint }}>{s.reg_no}</Mono></TableCell>
                                                                <TableCell sx={{ color: 'text.secondary' }}>{timeAgo(s.last_sent_at) || '—'}</TableCell>
                                                                <TableCell align="right">{s.count}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            )}
                                        </Section>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 5 }}>
                                        <Section title="How it works" sx={{ mb: 0 }}>
                                            {[
                                                ['Upload', 'Drop the Consolidated Academic Status PDF on the Low Attendance page.'],
                                                ['Review', 'Check the students below 75% and their subjects. Fix any missing emails.'],
                                                ['Send', 'Enter your Gmail app password, press Test, then send. You get a delivery summary.'],
                                            ].map(([t, d], i) => (
                                                <Box key={t} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                                                    <Box sx={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, color: tokens.accent, border: `1px solid ${alpha(tokens.accent, 0.45)}` }}>{i + 1}</Box>
                                                    <Box><Typography variant="subtitle2">{t}</Typography><Typography variant="body2" color="text.secondary">{d}</Typography></Box>
                                                </Box>
                                            ))}
                                            <Divider sx={{ my: 2 }} />
                                            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Most used subject line</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 500, mb: 2 }}>{analytics.most_frequent_subject || '—'}</Typography>
                                            <Link href={GMAIL_APP_PASSWORD_URL} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.8125rem', fontWeight: 500 }}>
                                                Create your Gmail app password <OpenInNewIcon sx={{ fontSize: 14 }} />
                                            </Link>
                                        </Section>
                                    </Grid>
                                </Grid>
                            </>
                        ) : (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}><CircularProgress /></Box>
                        )}
                    </>
                )}

                {view === 'workflow' && (
                    <>
                        <PageHeader
                            eyebrow="Low Attendance"
                            title="Notify students below 75%"
                            description="Upload the report, review who gets an email, then send from your Gmail account. Parents are CC'd automatically."
                        />

                        <Section step="1" title="Upload attendance report" description={`"Faculty Advisor's Consolidated Academic Status" PDF`}>
                            <Dropzone onFile={(f) => { setFile(f); processPdf(f); }} busy={busyWorkflow} fileName={file?.name} hint="PDF only · the report is read on the server and not stored" />
                            {pdfSummary && (
                                <Grid container spacing={2} sx={{ mt: 1 }}>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label="Students in PDF" value={pdfSummary.total_students} /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label="Subject records" value={pdfSummary.total_records} accent={tokens.info} /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label={`Below ${ATTENDANCE_THRESHOLD}%`} value={pdfSummary.low_attendance_students} accent={tokens.warning} /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatCard label="Not in database" value={listMode ? missingCount : '—'} accent={tokens.danger} /></Grid>
                                </Grid>
                            )}
                        </Section>

                        <Section
                            step="2"
                            title="Review students"
                            description={displayData.length ? `${displayData.length} student(s) in the list${listMode === 'low' ? ` · ${lowCount} below ${ATTENDANCE_THRESHOLD}%` : ''}` : 'Students appear here after you upload a PDF.'}
                            contentSx={{ p: 0 }}
                            actions={<>
                                <ToggleButtonGroup size="small" exclusive value={listMode || null} onChange={(e, v) => { if (v === 'low') handleListLow(); if (v === 'all') handleListAll(); }} disabled={!intermediateCsv || busyWorkflow}>
                                    <ToggleButton value="low">Below {ATTENDANCE_THRESHOLD}%</ToggleButton>
                                    <ToggleButton value="all">All students</ToggleButton>
                                </ToggleButtonGroup>
                                <Button size="small" variant="outlined" startIcon={<PersonAddAltOutlinedIcon />} onClick={() => setShowManualAdd(v => !v)}>Add manually</Button>
                                <BusyButton size="small" variant="outlined" startIcon={<FileDownloadOutlinedIcon />} loading={isExporting} onClick={handleExportExcel} disabled={displayData.length === 0}>Excel</BusyButton>
                                {displayData.length > 0 && <Button size="small" color="error" onClick={handleClearDisplay}>Clear</Button>}
                            </>}
                        >
                            <Collapse in={showManualAdd}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, p: 2, borderBottom: `1px solid ${tokens.border}`, backgroundColor: tokens.surfaceRaised }}>
                                    <TextField label="Reg. No" value={manualRegNo} onChange={e => setManualRegNo(e.target.value)} size="small" />
                                    <TextField label="Name" value={manualName} onChange={e => setManualName(e.target.value)} size="small" />
                                    <TextField label="Student email" value={manualStudentEmail} onChange={e => setManualStudentEmail(e.target.value)} size="small" />
                                    <TextField label="Parent email" value={manualParentEmail} onChange={e => setManualParentEmail(e.target.value)} size="small" />
                                    <Button variant="contained" onClick={handleAddManualStudent} disabled={!manualRegNo}>Add to list</Button>
                                </Box>
                            </Collapse>
                            {displayData.length === 0 ? (
                                <EmptyState
                                    icon={<FactCheckOutlinedIcon />}
                                    title={busyWorkflow ? 'Reading the report…' : (intermediateCsv ? 'No students to show' : 'No report uploaded yet')}
                                    description={busyWorkflow ? 'This usually takes a few seconds.' : (intermediateCsv ? `Nobody is below ${ATTENDANCE_THRESHOLD}%. Switch to "All students" to see everyone.` : 'Upload the attendance PDF above, or add students manually.')}
                                />
                            ) : (
                                <TableContainer sx={{ maxHeight: 480, border: 'none', borderRadius: 0 }}>
                                    <Table size="small" stickyHeader>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Student</TableCell>
                                                <TableCell>Student email</TableCell>
                                                <TableCell>Parent email</TableCell>
                                                <TableCell>Below {ATTENDANCE_THRESHOLD}%</TableCell>
                                                <TableCell>Last emailed</TableCell>
                                                <TableCell align="right" width={48} />
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {displayData.map((student, idx) => {
                                                const low = student.low_attendance_subjects || [];
                                                return (
                                                    <TableRow key={student.reg_no || idx} hover>
                                                        <TableCell sx={{ minWidth: 200 }}>
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                <Typography variant="body2" sx={{ fontWeight: 500 }}>{toTitleCase(student.name || '') || 'Unknown'}</Typography>
                                                                {student.missing && <StatusChip status="pending" label="Not in DB" />}
                                                            </Box>
                                                            <Mono sx={{ color: tokens.textFaint }}>{student.reg_no}</Mono>
                                                        </TableCell>
                                                        <TableCell>{student.student_email || <Typography component="span" variant="body2" color="error.main">Missing</Typography>}</TableCell>
                                                        <TableCell>{student.parent_email || <Typography component="span" variant="body2" color="text.disabled">—</Typography>}</TableCell>
                                                        <TableCell sx={{ minWidth: 240 }}>
                                                            {low.length > 0 ? (
                                                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                                    {low.map((s, i) => (
                                                                        <Tooltip key={i} title={`${s.Type || 'Subject'} · ${Number(s.Percentage).toFixed(2)}%`}>
                                                                            <Chip size="small" variant="outlined" label={<><Mono>{s.Subject}</Mono> · {Number(s.Percentage).toFixed(1)}%</>}
                                                                                sx={{ color: s.Percentage < 50 ? tokens.danger : tokens.warning, borderColor: alpha(s.Percentage < 50 ? tokens.danger : tokens.warning, 0.35) }} />
                                                                        </Tooltip>
                                                                    ))}
                                                                </Box>
                                                            ) : <Typography component="span" variant="body2" color="text.disabled">—</Typography>}
                                                        </TableCell>
                                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                            {student.last_notified_at ? (
                                                                <Tooltip title={`${student.times_notified} email(s) so far · last on ${new Date(student.last_notified_at).toLocaleString()}`}>
                                                                    <Typography component="span" variant="body2" sx={{ color: (Date.now() - new Date(student.last_notified_at)) < 86400000 ? tokens.warning : tokens.textMuted }}>
                                                                        {timeAgo(student.last_notified_at)}
                                                                    </Typography>
                                                                </Tooltip>
                                                            ) : <Typography component="span" variant="body2" color="text.disabled">Never</Typography>}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            <Tooltip title="Remove from list"><IconButton size="small" onClick={() => handleRemoveStudentRow(idx)}><CloseIcon fontSize="small" /></IconButton></Tooltip>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </Section>

                        {displayData.some(s => s.last_notified_at && (Date.now() - new Date(s.last_notified_at)) < 86400000) && (
                            <Alert severity="warning" sx={{ mb: 3 }}>
                                Some students in this list were already emailed in the last 24 hours (see "Last emailed"). Remove them if you don't want to email them again.
                            </Alert>
                        )}

                        <Section step="3" title="Send emails" description="Enter your Gmail app password in the next step. Each student gets a personalised email listing their subjects, and you get a delivery summary.">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                                <Button variant="contained" size="large" startIcon={<SendIcon />} onClick={() => setIsModalOpen(true)} disabled={displayData.length === 0 || busyWorkflow}>
                                    Review &amp; send {displayData.length > 0 ? `${displayData.length} email${displayData.length > 1 ? 's' : ''}` : 'emails'}
                                </Button>
                                <Typography variant="body2" color="text.secondary">Sending from <strong style={{ color: tokens.text }}>{user.email}</strong></Typography>
                            </Box>
                        </Section>
                    </>
                )}

                {view === 'alert' && (
                    <>
                        <PageHeader eyebrow="Mass Alert" title="Message every student" description="Send one announcement to every student in the database (parents in CC). Use [Student Name] to personalise it." />
                        <Section title="Compose announcement" description="Exam schedules, holidays, urgent notices…">
                            <EmptyState
                                icon={<CampaignOutlinedIcon />}
                                title={`Reaches all students in the database`}
                                description="You'll choose a template or write the message, then enter your Gmail app password to send."
                                action={<BusyButton variant="contained" startIcon={<EditOutlinedIcon />} loading={isSendingAlert} loadingText="Sending…" onClick={() => setIsAlertModalOpen(true)}>Compose mass alert</BusyButton>}
                            />
                        </Section>
                    </>
                )}

                {view === 'monitor' && (
                    <>
                        <PageHeader eyebrow="Tools" title="Mail Monitor" description="Watch an IMAP inbox for new messages whose subject contains a keyword. Monitors run while the server is running." />
                        <Grid container spacing={3}>
                            <Grid size={{ xs: 12, md: 5 }}>
                                <Section title="New monitor" sx={{ mb: 0 }}>
                                    <Stack spacing={2}>
                                        <TextField size="small" label="Monitor name" name="name" value={newMonitor.name} onChange={handleMonitorFieldChange} fullWidth />
                                        <Stack direction="row" spacing={1.5}>
                                            <TextField size="small" label="IMAP host" name="imap_host" value={newMonitor.imap_host} onChange={handleMonitorFieldChange} fullWidth />
                                            <TextField size="small" label="Port" name="imap_port" type="number" value={newMonitor.imap_port} onChange={handleMonitorFieldChange} sx={{ width: 110 }} />
                                        </Stack>
                                        <TextField size="small" label="Email address" name="username" value={newMonitor.username} onChange={handleMonitorFieldChange} fullWidth />
                                        <TextField size="small" label="Password / app password" type="password" name="password" value={newMonitor.password} onChange={handleMonitorFieldChange} fullWidth />
                                        <Stack direction="row" spacing={1.5}>
                                            <TextField size="small" label="Folder" name="folder" value={newMonitor.folder} onChange={handleMonitorFieldChange} fullWidth />
                                            <TextField size="small" label="Interval (s)" name="interval_seconds" type="number" value={newMonitor.interval_seconds} onChange={handleMonitorFieldChange} sx={{ width: 130 }} />
                                        </Stack>
                                        <TextField size="small" label="Subject contains" name="subject_contains" value={newMonitor.subject_contains} onChange={handleMonitorFieldChange} fullWidth helperText="Keyword to match in the subject or body." />
                                        <BusyButton variant="contained" onClick={handleCreateMonitor} loading={isCreatingMonitor} loadingText="Creating…" sx={{ alignSelf: 'flex-start' }}>Create monitor</BusyButton>
                                    </Stack>
                                </Section>
                            </Grid>
                            <Grid size={{ xs: 12, md: 7 }}>
                                <Section title="Monitors" contentSx={{ p: 0 }}>
                                    {monitorLoading ? <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box> : monitors.length === 0 ? (
                                        <EmptyState icon={<MarkEmailReadOutlinedIcon />} title="No monitors yet" description="Create one on the left to start watching an inbox." />
                                    ) : (
                                        <Table size="small">
                                            <TableHead><TableRow><TableCell>Monitor</TableCell><TableCell>Keyword</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
                                            <TableBody>
                                                {monitors.map(m => (
                                                    <TableRow key={m.id} hover selected={selectedMonitorId === m.id}>
                                                        <TableCell>
                                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>{m.name}</Typography>
                                                            <Typography variant="caption" color="text.secondary">{m.username} · every {m.interval_seconds}s{m.last_checked ? ` · checked ${new Date(m.last_checked * 1000).toLocaleTimeString()}` : ''}</Typography>
                                                        </TableCell>
                                                        <TableCell><Mono>{m.subject_contains}</Mono></TableCell>
                                                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                                            <Button size="small" onClick={() => handleSelectMonitor(m.id)}>{selectedMonitorId === m.id ? 'Viewing' : 'Matches'}</Button>
                                                            <Button size="small" color="error" onClick={() => handleDeleteMonitor(m.id)}>Delete</Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </Section>
                                {selectedMonitorId && (
                                    <Section title="Matches" description="Newest matching messages for the selected monitor." contentSx={{ p: 0 }} sx={{ mb: 0 }}>
                                        {monitorMatches.length === 0 ? <EmptyState title="No matches yet" description="New matching emails will appear here." /> : (
                                            <List disablePadding>
                                                {monitorMatches.map((match, idx) => (
                                                    <ListItem key={idx} divider sx={{ flexDirection: 'column', alignItems: 'flex-start', px: 3 }}>
                                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{match.subject}</Typography>
                                                        <Typography variant="caption" color="text.secondary">{match.from} · {new Date(match.timestamp).toLocaleString()}</Typography>
                                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{match.snippet}</Typography>
                                                    </ListItem>
                                                ))}
                                            </List>
                                        )}
                                    </Section>
                                )}
                            </Grid>
                        </Grid>
                    </>
                )}

                {view === 'history' && (
                    <>
                        <PageHeader eyebrow="History" title="Sent emails" description="Every email sent through MonitorMail, newest first." />
                        <TextField fullWidth size="small" placeholder="Search by registration number or name" value={historySearch}
                            onChange={e => { setHistorySearch(e.target.value); fetchHistory(e.target.value); }} sx={{ mb: 2 }}
                            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
                        {history.length === 0 ? (
                            <Paper><EmptyState icon={<HistoryIcon />} title="No emails found" description={historySearch ? 'Try a different search.' : 'Emails you send will be listed here.'} /></Paper>
                        ) : (
                            <TableContainer component={Paper}>
                                <Table size="small">
                                    <TableHead><TableRow><TableCell>Student</TableCell><TableCell>Subject</TableCell><TableCell>Recipients</TableCell><TableCell>Sent</TableCell><TableCell width={48} /></TableRow></TableHead>
                                    <TableBody>
                                        {history.map(h => (
                                            <React.Fragment key={h.id}>
                                                <TableRow hover sx={{ cursor: 'pointer', '& > td': { borderBottom: expandedHistoryId === h.id ? 'none' : undefined } }} onClick={() => setExpandedHistoryId(expandedHistoryId === h.id ? null : h.id)}>
                                                    <TableCell><Typography variant="body2" sx={{ fontWeight: 500 }}>{toTitleCase(h.student_name || '')}</Typography><Mono sx={{ color: tokens.textFaint }}>{h.student_reg_no}</Mono></TableCell>
                                                    <TableCell>{h.subject}</TableCell>
                                                    <TableCell sx={{ color: 'text.secondary', maxWidth: 260 }}>{h.recipients}</TableCell>
                                                    <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="body2">{new Date(h.sent_at).toLocaleDateString()}</Typography><Typography variant="caption" color="text.secondary">{h.teacher_email}</Typography></TableCell>
                                                    <TableCell>{expandedHistoryId === h.id ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</TableCell>
                                                </TableRow>
                                                {expandedHistoryId === h.id && (
                                                    <TableRow>
                                                        <TableCell colSpan={5} sx={{ pt: 0 }}>
                                                            <Box component="pre" sx={{ m: 0, p: 2, borderRadius: 1.5, backgroundColor: '#0e0f11', border: `1px solid ${tokens.border}`, whiteSpace: 'pre-wrap', fontFamily: tokens.mono, fontSize: '0.78rem', color: tokens.textMuted }}>{h.body}</Box>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </>
                )}

                {view === 'approvals' && user.is_admin && (
                    <>
                        <PageHeader eyebrow="Directory" title="Teacher approvals"
                            description="Teachers who registered and verified an @srmist.edu.in email. Approved teachers can sign in right away and are notified by email."
                            actions={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchPendingTeachers}>Refresh</Button>} />
                        {pendingTeachers.length === 0 ? (
                            <Paper><EmptyState icon={<HowToRegOutlinedIcon />} title="You're all caught up" description="No registrations are waiting for approval." /></Paper>
                        ) : (
                            <TableContainer component={Paper}>
                                <Table>
                                    <TableHead><TableRow><TableCell>Teacher</TableCell><TableCell>Registered</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
                                    <TableBody>
                                        {pendingTeachers.map(t => (
                                            <TableRow key={t.id} hover>
                                                <TableCell><Typography variant="body2" sx={{ fontWeight: 500 }}>{t.name}</Typography><Typography variant="caption" color="text.secondary">{t.email}</Typography></TableCell>
                                                <TableCell>{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</TableCell>
                                                <TableCell><StatusChip status="pending" /></TableCell>
                                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                                    <Button size="small" color="error" disabled={reviewingId === t.id} onClick={() => askConfirm({ title: 'Reject registration?', message: `${t.name} (${t.email}) will not be able to sign in. They will be notified by email.`, confirmLabel: 'Reject', danger: true, onConfirm: () => handleReviewTeacher(t, false) })} sx={{ mr: 1 }}>Reject</Button>
                                                    <BusyButton size="small" variant="contained" startIcon={<CheckIcon />} loading={reviewingId === t.id} onClick={() => handleReviewTeacher(t, true)}>Approve</BusyButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </>
                )}

                {view === 'teachers' && user.is_admin && (
                    <>
                        <PageHeader eyebrow="Directory" title="Teachers" description="Everyone who can sign in to MonitorMail. Teachers you add here are approved immediately."
                            actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenEditModal({ name: '', email: '', password: '', is_admin: false }, 'teacher')}>Add teacher</Button>} />
                        <TableContainer component={Paper}>
                            <Table>
                                <TableHead><TableRow><TableCell>Teacher</TableCell><TableCell>Role</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
                                <TableBody>
                                    {teachers.map(t => (
                                        <TableRow key={t.id} hover>
                                            <TableCell><Typography variant="body2" sx={{ fontWeight: 500 }}>{t.name}</Typography><Typography variant="caption" color="text.secondary">{t.email}</Typography></TableCell>
                                            <TableCell>{t.is_admin ? <Chip size="small" label="Admin" sx={{ color: tokens.info, backgroundColor: alpha(tokens.info, 0.1) }} /> : <Typography variant="body2" color="text.secondary">Teacher</Typography>}</TableCell>
                                            <TableCell><StatusChip status={t.status || 'approved'} /></TableCell>
                                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                                <Button size="small" onClick={() => handleOpenEditModal(t, 'teacher')}>Edit</Button>
                                                <Button size="small" color="error" disabled={t.id === user.id} onClick={() => handleDeleteTeacher(t)}>Delete</Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </>
                )}

                {view === 'templates' && (
                    <>
                        <PageHeader eyebrow="Workspace" title="Email templates"
                            description={<>Reusable email bodies. Use <Mono sx={{ color: tokens.accent }}>[Student Name]</Mono> and <Mono sx={{ color: tokens.accent }}>[Subject List]</Mono>; they are filled in per student.</>}
                            actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setCurrentTemplate({ id: null, name: '', body: '' }); setTemplateModalOpen(true); }}>New template</Button>} />
                        {templates.length === 0 ? (
                            <Paper><EmptyState icon={<ArticleOutlinedIcon />} title="No templates yet" description="Create your first template to reuse it when sending." /></Paper>
                        ) : (
                            <Grid container spacing={2}>
                                {templates.map(template => (
                                    <Grid size={{ xs: 12, md: 6 }} key={template.id}>
                                        <Paper sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', '&:hover': { borderColor: tokens.borderStrong } }}>
                                            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{template.name}</Typography>
                                            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: tokens.mono, fontSize: '0.75rem', whiteSpace: 'pre-wrap', flexGrow: 1, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                {template.body}
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                                                <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => { setCurrentTemplate(template); setTemplateModalOpen(true); }}>Edit</Button>
                                                <Button size="small" color="error" onClick={() => handleDeleteTemplate(template)}>Delete</Button>
                                            </Box>
                                        </Paper>
                                    </Grid>
                                ))}
                            </Grid>
                        )}
                    </>
                )}

                {view === 'students' && (
                    <>
                        <PageHeader eyebrow="Directory" title="Students" description="Student and parent contact details used when sending emails."
                            actions={<><Button variant="outlined" startIcon={<FileUploadOutlinedIcon />} onClick={() => setImportOpen(true)}>Import CSV / Excel</Button><Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenEditModal({ reg_no: '', name: '', section: '', department: '', phone_number: '', email: '', parent_mobile: '', parent_email: '' }, 'student')}>Add student</Button></>} />
                        <TextField
                            fullWidth size="small"
                            placeholder="Search by name or registration number, then press Enter"
                            value={managementSearch}
                            onChange={e => setManagementSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchStudents(managementSearch)}
                            sx={{ mb: 2 }}
                            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                        />
                        <TableContainer component={Paper} sx={{ maxHeight: 640 }}>
                            <Table size="small" stickyHeader>
                                <TableHead><TableRow><TableCell>Student</TableCell><TableCell>Section</TableCell><TableCell>Student email</TableCell><TableCell>Parent email</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
                                <TableBody>
                                    {loading ? (
                                        <TableRow><TableCell colSpan={5} align="center" sx={{ py: 6 }}><CircularProgress size={24} /></TableCell></TableRow>
                                    ) : students.length === 0 ? (
                                        <TableRow><TableCell colSpan={5}><EmptyState title="No students found" description="Try another search or add a student." /></TableCell></TableRow>
                                    ) : students.map(s => (
                                        <TableRow key={s.id} hover>
                                            <TableCell><Typography variant="body2" sx={{ fontWeight: 500 }}>{toTitleCase(s.name || '')}</Typography><Mono sx={{ color: tokens.textFaint }}>{s.reg_no}</Mono></TableCell>
                                            <TableCell sx={{ color: 'text.secondary' }}>{[s.department, s.section].filter(Boolean).join(' · ') || '—'}</TableCell>
                                            <TableCell>{s.email || <Typography component="span" variant="body2" color="text.disabled">—</Typography>}</TableCell>
                                            <TableCell>{s.parent_email || <Typography component="span" variant="body2" color="text.disabled">—</Typography>}</TableCell>
                                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                                <Button size="small" onClick={() => handleOpenEditModal(s, 'student')}>Edit</Button>
                                                {user.is_admin && <Button size="small" color="error" onClick={() => handleDeleteStudent(s)}>Delete</Button>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        {!loading && students.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{students.length} student(s)</Typography>}
                    </>
                )}
                {view === 'security' && user.is_admin && (
                    <>
                        <PageHeader eyebrow="Directory" title="Security log"
                            description="Sign-ins, failed attempts, approvals, password changes, deletions and email sends. Newest first."
                            actions={<BusyButton variant="outlined" startIcon={<RefreshIcon />} loading={auditLoading} onClick={fetchAuditLog}>Refresh</BusyButton>} />
                        {auditLog.length === 0 ? (
                            <Paper><EmptyState icon={<ShieldOutlinedIcon />} title={auditLoading ? 'Loading…' : 'No events yet'} description="Security events will appear here." /></Paper>
                        ) : (
                            <TableContainer component={Paper} sx={{ maxHeight: 680 }}>
                                <Table size="small" stickyHeader>
                                    <TableHead><TableRow><TableCell>When</TableCell><TableCell>Event</TableCell><TableCell>By</TableCell><TableCell>Target</TableCell><TableCell>IP</TableCell></TableRow></TableHead>
                                    <TableBody>
                                        {auditLog.map(ev => {
                                            const bad = /failed|blocked|rejected|deleted/.test(ev.action);
                                            return (
                                                <TableRow key={ev.id} hover>
                                                    <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{new Date(ev.at).toLocaleString()}</TableCell>
                                                    <TableCell><StatusChip status={bad ? 'failed' : 'approved'} label={ev.action.replace(/_/g, ' ')} /></TableCell>
                                                    <TableCell>{ev.actor || '—'}</TableCell>
                                                    <TableCell sx={{ color: 'text.secondary' }}>{ev.target}{ev.details ? ` · ${ev.details}` : ''}</TableCell>
                                                    <TableCell><Mono sx={{ color: tokens.textFaint }}>{ev.ip}</Mono></TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </>
                )}

                {view === 'account' && (
                    <>
                        <PageHeader eyebrow="Settings" title="Account" description="Your profile and sign-in settings." />
                        <Grid container spacing={3}>
                            <Grid size={{ xs: 12, md: 5 }}>
                                <Section title="Profile" sx={{ mb: 0 }}>
                                    {[['Name', user.name], ['Email', user.email], ['Role', user.is_admin ? 'Administrator' : 'Teacher']].map(([k, v]) => (
                                        <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1.25, borderBottom: `1px solid ${tokens.border}`, '&:last-of-type': { borderBottom: 'none' } }}>
                                            <Typography variant="body2" color="text.secondary">{k}</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'right', wordBreak: 'break-all' }}>{v}</Typography>
                                        </Box>
                                    ))}
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                                        Emails to students are sent from this address using your Gmail app password.
                                    </Typography>
                                </Section>
                            </Grid>
                            <Grid size={{ xs: 12, md: 7 }}>
                                <Section title="Change password" description={`${PASSWORD_RULES}. Changing it signs you out on other devices.`} sx={{ mb: 3 }}>
                                    <Box component="form" onSubmit={handleChangePassword}>
                                        <Stack spacing={2}>
                                            <TextField size="small" type="password" label="Current password" value={passwordForm.current} onChange={e => setPasswordForm(f => ({ ...f, current: e.target.value }))} autoComplete="current-password" />
                                            <TextField size="small" type="password" label="New password" value={passwordForm.next} onChange={e => setPasswordForm(f => ({ ...f, next: e.target.value }))} autoComplete="new-password" />
                                            <TextField size="small" type="password" label="Confirm new password" value={passwordForm.confirm} onChange={e => setPasswordForm(f => ({ ...f, confirm: e.target.value }))} autoComplete="new-password" />
                                            <BusyButton type="submit" variant="contained" loading={isChangingPassword} loadingText="Saving…" disabled={!passwordForm.current || !passwordForm.next} sx={{ alignSelf: 'flex-start' }}>Update password</BusyButton>
                                        </Stack>
                                    </Box>
                                </Section>
                                <Section title="Gmail app password" description="Check your app password before a big send. It's kept in this browser tab only until you sign out." sx={{ mb: 0 }}>
                                    <GmailAppPasswordField value={gmailAppPassword} onChange={setGmailAppPassword} senderEmail={user.email} />
                                </Section>
                            </Grid>
                        </Grid>
                    </>
                )}
            </AppShell>

            <ImportStudentsDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={(res) => { if (res.created || res.updated) fetchStudents(managementSearch); }} />

            {/* Workflow Email Modal */}
            <EmailModal open={isModalOpen} onClose={() => setIsModalOpen(false)} data={displayData} onSendAll={handleSendAllEmails} onSendSingle={handleSendSingleEmail} loading={loading} templates={templates} title="Review & send emails" user={user} setDisplayData={setDisplayData} setSnackbar={setSnackbar} gmailAppPassword={gmailAppPassword} setGmailAppPassword={setGmailAppPassword} />

            {/* Mass Alert Modal */}
            <MassAlertModal
                open={isAlertModalOpen}
                onClose={() => setIsAlertModalOpen(false)}
                onSend={handleSendMassAlert}
                loading={isSendingAlert}
                templates={templates}
                user={user}
                gmailAppPassword={gmailAppPassword}
                setGmailAppPassword={setGmailAppPassword}
            />

            {/* Template Dialog */}
            <Dialog open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ fontWeight: 600 }}>{currentTemplate.id ? 'Edit template' : 'New template'}</DialogTitle>
                <DialogContent>
                    <TextField fullWidth size="small" label="Template name" value={currentTemplate.name} onChange={e => setCurrentTemplate({ ...currentTemplate, name: e.target.value })} sx={{ mt: 1, mb: 2 }} />
                    <TextField fullWidth multiline minRows={12} label="Body" value={currentTemplate.body} onChange={e => setCurrentTemplate({ ...currentTemplate, body: e.target.value })}
                        helperText="Placeholders: [Student Name], [Subject List]" InputProps={{ sx: { fontFamily: tokens.mono, fontSize: '0.8125rem' } }} />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button variant="outlined" onClick={() => setTemplateModalOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSaveTemplate} disabled={!currentTemplate.name || !currentTemplate.body}>Save template</Button>
                </DialogActions>
            </Dialog>

            {/* Teacher / Student Edit Dialog */}
            <Dialog open={editModalOpen} onClose={() => setEditModalOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontWeight: 600 }}>{currentItem?.id ? 'Edit' : 'Add'} {modalType}</DialogTitle>
                <DialogContent>
                    {currentItem && modalType === 'teacher' && (
                        <Grid container spacing={2} sx={{ mt: 0 }}>
                            <Grid size={{ xs: 12 }}><TextField size="small" name="name" label="Full name" value={currentItem.name || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12 }}><TextField size="small" name="email" label="Email" value={currentItem.email || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12 }}><TextField size="small" name="password" label={currentItem.id ? 'New password (optional)' : 'Password'} type="password" onChange={handleItemChange} fullWidth helperText={currentItem.id ? 'Leave blank to keep the current password' : ''} /></Grid>
                            <Grid size={{ xs: 12 }}><FormControlLabel control={<Checkbox name="is_admin" checked={currentItem.is_admin || false} onChange={handleItemChange} />} label={<Typography variant="body2">Administrator (can manage teachers and approvals)</Typography>} /></Grid>
                        </Grid>
                    )}
                    {currentItem && modalType === 'student' && (
                        <Grid container spacing={2} sx={{ mt: 0 }}>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="reg_no" label="Reg. No" value={currentItem.reg_no || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="name" label="Name" value={currentItem.name || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="section" label="Section" value={currentItem.section || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="department" label="Department" value={currentItem.department || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="email" label="Student email" value={currentItem.email || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="phone_number" label="Student phone" value={currentItem.phone_number || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="parent_email" label="Parent email" value={currentItem.parent_email || ''} onChange={handleItemChange} fullWidth /></Grid>
                            <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" name="parent_mobile" label="Parent phone" value={currentItem.parent_mobile || ''} onChange={handleItemChange} fullWidth /></Grid>
                        </Grid>
                    )}
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button variant="outlined" onClick={() => setEditModalOpen(false)}>Cancel</Button>
                    <BusyButton variant="contained" onClick={handleSaveItem} loading={loading} loadingText="Saving…">Save changes</BusyButton>
                </DialogActions>
            </Dialog>

            <ConfirmDialog {...confirmState} onClose={() => setConfirmState(s => ({ ...s, open: false }))} />

            <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
                <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity || 'info'} variant="outlined"
                    sx={{ width: '100%', maxWidth: 480, backgroundColor: tokens.surfaceRaised, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </ThemeProvider>
    );
}

export default App;
