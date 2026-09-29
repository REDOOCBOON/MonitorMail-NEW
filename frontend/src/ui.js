import React, { useState } from 'react';
import {
    Box, Typography, Button, CircularProgress, Paper, Drawer, IconButton, Badge, Divider, Tooltip,
    Dialog, DialogTitle, DialogContent, DialogActions, Chip, Link, useMediaQuery
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import CheckIcon from '@mui/icons-material/Check';
import { tokens } from './theme';

export const SIDEBAR_WIDTH = 248;

// --- Brand ---
export const Logo = ({ size = 28, showName = true }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{
            width: size, height: size, borderRadius: '8px', display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${tokens.accent} 0%, #00b3ff 140%)`,
            boxShadow: `0 0 24px ${alpha(tokens.accent, 0.35)}`,
        }}>
            <MailOutlineIcon sx={{ fontSize: size * 0.6, color: tokens.accentText }} />
        </Box>
        {showName && <Typography sx={{ fontWeight: 650, fontSize: '1.05rem', letterSpacing: '-0.02em' }}>MonitorMail</Typography>}
    </Box>
);

// --- Buttons ---
// Keeps its size while loading: the icon becomes a spinner instead of the label being replaced.
export const BusyButton = ({ loading, loadingText, startIcon, children, disabled, ...props }) => (
    <Button
        {...props}
        disabled={disabled || loading}
        startIcon={loading ? <CircularProgress size={14} color="inherit" thickness={5} /> : startIcon}
    >
        {loading && loadingText ? loadingText : children}
    </Button>
);

// --- Page structure ---
export const PageHeader = ({ title, description, actions, eyebrow }) => (
    <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'flex-end' }, justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
            {eyebrow && <Typography variant="overline" sx={{ color: tokens.accent }}>{eyebrow}</Typography>}
            <Typography variant="h5" component="h1">{title}</Typography>
            {description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>{description}</Typography>}
        </Box>
        {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>}
    </Box>
);

export const Section = ({ title, description, actions, children, step, sx, contentSx }) => (
    <Paper sx={{ mb: 3, overflow: 'hidden', ...sx }}>
        {(title || actions) && (
            <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', borderBottom: `1px solid ${tokens.border}` }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    {step && (
                        <Box sx={{
                            width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                            fontSize: 12, fontWeight: 600, color: tokens.accent, border: `1px solid ${alpha(tokens.accent, 0.45)}`, backgroundColor: alpha(tokens.accent, 0.08)
                        }}>{step}</Box>
                    )}
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="h6" sx={{ fontSize: '0.975rem' }}>{title}</Typography>
                        {description && <Typography variant="body2" color="text.secondary">{description}</Typography>}
                    </Box>
                </Box>
                {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</Box>}
            </Box>
        )}
        <Box sx={{ p: 3, ...contentSx }}>{children}</Box>
    </Paper>
);

export const StatCard = ({ label, value, icon, hint, accent = tokens.accent }) => (
    <Paper sx={{ p: 2.5, height: '100%' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary">{label}</Typography>
                <Typography sx={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em', mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</Typography>
                {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
            </Box>
            {icon && (
                <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', color: accent, backgroundColor: alpha(accent, 0.1), border: `1px solid ${alpha(accent, 0.2)}`, flexShrink: 0 }}>
                    {icon}
                </Box>
            )}
        </Box>
    </Paper>
);

export const EmptyState = ({ icon, title, description, action }) => (
    <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
        {icon && <Box sx={{ color: tokens.textFaint, mb: 1.5, '& svg': { fontSize: 36 } }}>{icon}</Box>}
        <Typography variant="subtitle1">{title}</Typography>
        {description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 420, mx: 'auto' }}>{description}</Typography>}
        {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
);

const STATUS_COLORS = { approved: tokens.accent, success: tokens.accent, pending: tokens.warning, rejected: tokens.danger, failed: tokens.danger };

export const StatusChip = ({ status, label }) => {
    const color = STATUS_COLORS[status] || tokens.textMuted;
    return (
        <Chip
            size="small"
            label={label || status}
            sx={{ color, backgroundColor: alpha(color, 0.1), border: `1px solid ${alpha(color, 0.3)}`, textTransform: 'capitalize',
                '&::before': { content: '""', width: 6, height: 6, borderRadius: '50%', backgroundColor: color, ml: 1, mr: -0.25 } }}
        />
    );
};

export const Mono = ({ children, sx }) => (
    <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: '0.78rem', ...sx }}>{children}</Box>
);

// --- File drop zone ---
export const Dropzone = ({ onFile, busy, fileName, accept = '.pdf,application/pdf', title, hint }) => {
    const [dragging, setDragging] = useState(false);
    const handleDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) onFile(f);
    };
    return (
        <Box
            component="label"
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                gap: 1, py: 5, px: 2, borderRadius: 2, cursor: busy ? 'progress' : 'pointer',
                border: `1px dashed ${dragging ? tokens.accent : tokens.borderStrong}`,
                backgroundColor: dragging ? alpha(tokens.accent, 0.06) : '#0e0f11',
                '&:hover': { borderColor: busy ? tokens.borderStrong : tokens.textFaint },
            }}
        >
            <input type="file" hidden accept={accept} disabled={busy} onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} />
            {busy ? <CircularProgress size={28} thickness={4} /> : <CloudUploadOutlinedIcon sx={{ fontSize: 32, color: dragging ? tokens.accent : tokens.textMuted }} />}
            <Typography variant="subtitle2" sx={{ fontSize: '0.875rem' }}>
                {busy ? 'Reading PDF…' : (title || <>Drop your PDF here or <Box component="span" sx={{ color: tokens.accent }}>browse</Box></>)}
            </Typography>
            <Typography variant="caption" color="text.secondary">{fileName ? <>Current file: <Mono>{fileName}</Mono></> : hint}</Typography>
        </Box>
    );
};

// --- Confirm dialog (replaces window.confirm) ---
export const ConfirmDialog = ({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) => {
    const [busy, setBusy] = useState(false);
    const handleConfirm = async () => {
        setBusy(true);
        try { await onConfirm?.(); } finally { setBusy(false); onClose(); }
    };
    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600, pb: 1 }}>{title}</DialogTitle>
            <DialogContent><Typography variant="body2" color="text.secondary">{message}</Typography></DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button variant="outlined" onClick={onClose} disabled={busy}>Cancel</Button>
                <BusyButton variant="contained" color={danger ? 'error' : 'primary'} onClick={handleConfirm} loading={busy}>{confirmLabel}</BusyButton>
            </DialogActions>
        </Dialog>
    );
};

// --- Auth pages (sign in / register) ---
const FEATURES = [
    'Reads the Consolidated Academic Status PDF automatically',
    'Finds every student below 75%, subject by subject',
    'Emails students and CCs parents from your own Gmail',
];

export const AuthShell = ({ children }) => (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' }, backgroundColor: tokens.bg }}>
        <Box sx={{
            display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', p: 6,
            borderRight: `1px solid ${tokens.border}`, position: 'relative', overflow: 'hidden',
            background: `radial-gradient(600px 400px at 0% 0%, ${alpha(tokens.accent, 0.16)}, transparent 70%), radial-gradient(500px 360px at 100% 100%, ${alpha('#00b3ff', 0.1)}, transparent 70%), ${tokens.bg}`,
        }}>
            <Box sx={{ position: 'absolute', inset: 0, opacity: 0.35, pointerEvents: 'none',
                backgroundImage: `linear-gradient(${tokens.border} 1px, transparent 1px), linear-gradient(90deg, ${tokens.border} 1px, transparent 1px)`,
                backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse at 30% 30%, black 20%, transparent 75%)' }} />
            <Box sx={{ position: 'relative' }}><Logo size={32} /></Box>
            <Box sx={{ position: 'relative', maxWidth: 460 }}>
                <Typography sx={{ fontSize: '2.5rem', fontWeight: 650, letterSpacing: '-0.035em', lineHeight: 1.1 }}>
                    Attendance alerts,<br /><Box component="span" sx={{ color: tokens.accent }}>sent in minutes.</Box>
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 2, mb: 4 }}>
                    Upload the attendance report and MonitorMail sends a personal email to every student who needs one.
                </Typography>
                {FEATURES.map(f => (
                    <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                        <Box sx={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', backgroundColor: alpha(tokens.accent, 0.12), color: tokens.accent }}>
                            <CheckIcon sx={{ fontSize: 14 }} />
                        </Box>
                        <Typography variant="body2" sx={{ color: tokens.text }}>{f}</Typography>
                    </Box>
                ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ position: 'relative' }}>
                Faculty of Engineering and Technology · SRM Institute of Science and Technology
            </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 3, sm: 6 } }}>
            <Box sx={{ width: '100%', maxWidth: 400 }}>
                <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 4 }}><Logo /></Box>
                {children}
            </Box>
        </Box>
    </Box>
);

// --- App shell with sidebar ---
const NavItem = ({ item, active, onClick }) => (
    <Box
        component="button"
        type="button"
        onClick={onClick}
        sx={{
            all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 1.25,
            px: 1.25, py: 0.875, borderRadius: 1.5, cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500,
            color: active ? tokens.text : tokens.textMuted,
            backgroundColor: active ? tokens.hover : 'transparent',
            boxShadow: active ? `inset 2px 0 0 ${tokens.accent}` : 'none',
            '&:hover': { color: tokens.text, backgroundColor: tokens.hover },
            '&:focus-visible': { outline: `2px solid ${alpha(tokens.accent, 0.6)}` },
            '& svg': { fontSize: 18, color: active ? tokens.accent : 'inherit' },
        }}
    >
        {item.icon}
        <Box component="span" sx={{ flexGrow: 1 }}>{item.label}</Box>
        {item.badge > 0 && <Badge badgeContent={item.badge} color="warning" sx={{ mr: 1, '& .MuiBadge-badge': { position: 'static', transform: 'none', color: tokens.bg, fontWeight: 600 } }} />}
    </Box>
);

const SidebarContent = ({ navGroups, view, onNavigate, user, onLogout }) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 1.5 }}>
        <Box sx={{ px: 1, py: 1.5, mb: 1 }}><Logo /></Box>
        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
            {navGroups.map(group => (
                <Box key={group.label} sx={{ mb: 2 }}>
                    <Typography variant="overline" sx={{ display: 'block', px: 1.25, mb: 0.5, color: tokens.textFaint }}>{group.label}</Typography>
                    {group.items.map(item => (
                        <NavItem key={item.value} item={item} active={view === item.value} onClick={() => onNavigate(item.value)} />
                    ))}
                </Box>
            ))}
            <Link href="https://academia.srmist.edu.in/" target="_blank" rel="noopener noreferrer"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, fontSize: '0.8125rem', color: tokens.textMuted, '&:hover': { color: tokens.text } }}>
                Academia portal <OpenInNewIcon sx={{ fontSize: 14 }} />
            </Link>
        </Box>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1, py: 1 }}>
            <Box sx={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, fontWeight: 600, fontSize: 13,
                backgroundColor: alpha(tokens.accent, 0.12), color: tokens.accent, border: `1px solid ${alpha(tokens.accent, 0.3)}` }}>
                {(user?.name || user?.email || '?').trim().charAt(0).toUpperCase()}
            </Box>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.is_admin ? 'Admin · ' : ''}{user?.email}
                </Typography>
            </Box>
            <Tooltip title="Sign out"><IconButton size="small" onClick={onLogout}><LogoutIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
        <Typography variant="caption" sx={{ px: 1, pt: 0.5, color: tokens.textFaint, lineHeight: 1.5 }}>
            Support: ujjwal3rd@gmail.com · +91 8210052876
        </Typography>
    </Box>
);

export const AppShell = ({ navGroups, view, onNavigate, user, onLogout, children }) => {
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = (v) => { onNavigate(v); setMobileOpen(false); };
    const sidebar = <SidebarContent navGroups={navGroups} view={view} onNavigate={navigate} user={user} onLogout={onLogout} />;

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: tokens.bg }}>
            {isDesktop ? (
                <Box component="nav" sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, borderRight: `1px solid ${tokens.border}`, position: 'sticky', top: 0, height: '100vh', backgroundColor: tokens.bg }}>
                    {sidebar}
                </Box>
            ) : (
                <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} PaperProps={{ sx: { width: SIDEBAR_WIDTH, backgroundColor: tokens.bg, border: 'none', borderRight: `1px solid ${tokens.border}` } }}>
                    {sidebar}
                </Drawer>
            )}
            <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {!isDesktop && (
                    <Box sx={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderBottom: `1px solid ${tokens.border}`, backgroundColor: alpha(tokens.bg, 0.9), backdropFilter: 'blur(8px)' }}>
                        <IconButton onClick={() => setMobileOpen(true)} aria-label="Open menu"><MenuIcon /></IconButton>
                        <Logo size={24} />
                    </Box>
                )}
                <Box component="main" sx={{ flexGrow: 1, width: '100%', maxWidth: 1200, mx: 'auto', px: { xs: 2, sm: 3, md: 5 }, py: { xs: 3, md: 5 } }}>
                    {children}
                </Box>
            </Box>
        </Box>
    );
};

// --- Activity chart: one series (emails per day), bars with hover/focus tooltips ---
const BAR_COLOR = '#1faa78'; // validated against the dark surface; brightens to the accent on hover

export const ActivityChart = ({ data = [], height = 160 }) => {
    const max = Math.max(1, ...data.map(d => d.count));
    const total = data.reduce((sum, d) => sum + d.count, 0);
    const fmt = (iso, opts) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);
    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 2 }}>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em' }}>{total}</Typography>
                <Typography variant="body2" color="text.secondary">emails in the last {data.length} days</Typography>
            </Box>
            <Box sx={{ position: 'relative', height, display: 'flex', alignItems: 'flex-end', gap: '2px', borderBottom: `1px solid ${tokens.borderStrong}` }} role="list" aria-label="Emails sent per day">
                <Typography variant="caption" sx={{ position: 'absolute', top: -2, left: 0, color: tokens.textFaint }}>{max}</Typography>
                <Box sx={{ position: 'absolute', top: 8, left: 0, right: 0, borderTop: `1px dashed ${tokens.border}` }} />
                {data.map(d => (
                    <Tooltip key={d.date} arrow placement="top" title={<><strong>{d.count}</strong> email{d.count === 1 ? '' : 's'} · {fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</>}>
                        <Box role="listitem" tabIndex={0} aria-label={`${fmt(d.date, { day: 'numeric', month: 'long' })}: ${d.count} emails`}
                            sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'default', outline: 'none',
                                '&:hover > div, &:focus-visible > div': { backgroundColor: tokens.accent } }}>
                            <Box sx={{ width: '100%', maxWidth: 28, mx: 'auto', height: d.count ? `${Math.max(4, (d.count / max) * (height - 16))}px` : '2px',
                                borderRadius: d.count ? '4px 4px 0 0' : 0, backgroundColor: d.count ? BAR_COLOR : tokens.border, transition: 'background-color 0.15s' }} />
                        </Box>
                    </Tooltip>
                ))}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
                {data.length > 0 && [data[0], data[Math.floor(data.length / 2)], data[data.length - 1]].map((d, i) => (
                    <Typography key={i} variant="caption" sx={{ color: tokens.textFaint }}>{i === 2 ? 'Today' : fmt(d.date, { day: 'numeric', month: 'short' })}</Typography>
                ))}
            </Box>
        </Box>
    );
};

// "3 days ago" style label for a timestamp
export const timeAgo = (iso) => {
    if (!iso) return null;
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
