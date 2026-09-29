import { createTheme, alpha } from '@mui/material/styles';

// Design tokens: near-black surfaces, hairline borders, one bright green accent.
export const tokens = {
    bg: '#0b0c0d',
    surface: '#111214',
    surfaceRaised: '#16181a',
    hover: '#1b1d20',
    border: '#232528',
    borderStrong: '#2e3135',
    text: '#e8e9eb',
    textMuted: '#9a9ea6',
    textFaint: '#6b7078',
    accent: '#00e599',
    accentHover: '#00cc88',
    accentText: '#04150e',
    danger: '#ff5c5c',
    warning: '#f5b83d',
    info: '#5ab0ff',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: { main: tokens.accent, dark: tokens.accentHover, contrastText: tokens.accentText },
        secondary: { main: tokens.text, contrastText: tokens.bg },
        error: { main: tokens.danger },
        warning: { main: tokens.warning },
        info: { main: tokens.info },
        success: { main: tokens.accent },
        background: { default: tokens.bg, paper: tokens.surface },
        text: { primary: tokens.text, secondary: tokens.textMuted, disabled: tokens.textFaint },
        divider: tokens.border,
    },
    shape: { borderRadius: 8 },
    typography: {
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
        h4: { fontWeight: 600, fontSize: '1.75rem', letterSpacing: '-0.02em' },
        h5: { fontWeight: 600, fontSize: '1.375rem', letterSpacing: '-0.015em' },
        h6: { fontWeight: 600, fontSize: '1.05rem', letterSpacing: '-0.01em' },
        subtitle1: { fontWeight: 500 },
        subtitle2: { fontWeight: 500, fontSize: '0.8125rem' },
        body2: { fontSize: '0.8125rem', lineHeight: 1.55 },
        button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
        overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1.6 },
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: { backgroundColor: tokens.bg },
                '::selection': { background: alpha(tokens.accent, 0.3) },
                '*::-webkit-scrollbar': { width: 10, height: 10 },
                '*::-webkit-scrollbar-thumb': { background: tokens.borderStrong, borderRadius: 10, border: `2px solid ${tokens.bg}` },
                '*::-webkit-scrollbar-track': { background: 'transparent' },
            },
        },
        MuiPaper: {
            defaultProps: { elevation: 0 },
            styleOverrides: {
                root: { backgroundImage: 'none', backgroundColor: tokens.surface, border: `1px solid ${tokens.border}` },
            },
        },
        MuiButton: {
            defaultProps: { disableElevation: true },
            styleOverrides: {
                root: { borderRadius: 6, minHeight: 36, padding: '6px 14px', whiteSpace: 'nowrap' },
                sizeSmall: { minHeight: 30, padding: '4px 10px', fontSize: '0.8125rem' },
                sizeLarge: { minHeight: 42, padding: '8px 20px', fontSize: '0.9375rem' },
                containedPrimary: {
                    color: tokens.accentText,
                    '&:hover': { backgroundColor: tokens.accentHover },
                    '&.Mui-disabled': { backgroundColor: alpha(tokens.accent, 0.25), color: alpha(tokens.accentText, 0.7) },
                },
                outlined: {
                    borderColor: tokens.borderStrong,
                    color: tokens.text,
                    backgroundColor: tokens.surfaceRaised,
                    '&:hover': { borderColor: tokens.textFaint, backgroundColor: tokens.hover },
                    '&.Mui-disabled': { borderColor: tokens.border, color: tokens.textFaint },
                },
                outlinedError: { color: tokens.danger, '&:hover': { borderColor: tokens.danger, backgroundColor: alpha(tokens.danger, 0.08) } },
                text: { color: tokens.textMuted, '&:hover': { color: tokens.text, backgroundColor: tokens.hover } },
                textPrimary: { color: tokens.accent, '&:hover': { backgroundColor: alpha(tokens.accent, 0.08) } },
                textError: { color: tokens.danger, '&:hover': { backgroundColor: alpha(tokens.danger, 0.08) } },
                containedSuccess: { color: tokens.accentText },
            },
        },
        MuiIconButton: {
            styleOverrides: { root: { borderRadius: 6, color: tokens.textMuted, '&:hover': { color: tokens.text, backgroundColor: tokens.hover } } },
        },
        MuiOutlinedInput: {
            styleOverrides: {
                root: {
                    backgroundColor: '#0e0f11',
                    borderRadius: 6,
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.borderStrong },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tokens.textFaint },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: tokens.accent, borderWidth: 1, boxShadow: `0 0 0 3px ${alpha(tokens.accent, 0.15)}` },
                },
                input: { '&::placeholder': { color: tokens.textFaint, opacity: 1 } },
            },
        },
        MuiInputLabel: { styleOverrides: { root: { color: tokens.textMuted, '&.Mui-focused': { color: tokens.accent } } } },
        MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2, color: tokens.textFaint } } },
        MuiTextField: { defaultProps: { variant: 'outlined' } },
        MuiSelect: { defaultProps: { MenuProps: { PaperProps: { sx: { mt: 0.5, backgroundColor: tokens.surfaceRaised } } } } },
        MuiMenuItem: { styleOverrides: { root: { fontSize: '0.875rem', '&.Mui-selected': { backgroundColor: alpha(tokens.accent, 0.1) } } } },
        MuiTableCell: {
            styleOverrides: {
                root: { borderColor: tokens.border, padding: '10px 16px', fontSize: '0.8125rem' },
                head: {
                    color: tokens.textFaint, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase',
                    letterSpacing: '0.06em', backgroundColor: tokens.surface, whiteSpace: 'nowrap',
                },
            },
        },
        MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: tokens.hover } } } },
        MuiTableContainer: { styleOverrides: { root: { border: `1px solid ${tokens.border}`, borderRadius: 8 } } },
        MuiChip: {
            styleOverrides: {
                root: { borderRadius: 6, fontWeight: 500, height: 24, fontSize: '0.75rem' },
                outlined: { borderColor: tokens.borderStrong },
            },
        },
        MuiAlert: {
            defaultProps: { variant: 'outlined' },
            styleOverrides: {
                root: { borderRadius: 8, alignItems: 'center', fontSize: '0.8125rem' },
                outlinedSuccess: { borderColor: alpha(tokens.accent, 0.35), backgroundColor: alpha(tokens.accent, 0.06), color: tokens.text },
                outlinedWarning: { borderColor: alpha(tokens.warning, 0.35), backgroundColor: alpha(tokens.warning, 0.06), color: tokens.text },
                outlinedError: { borderColor: alpha(tokens.danger, 0.4), backgroundColor: alpha(tokens.danger, 0.06), color: tokens.text },
                outlinedInfo: { borderColor: alpha(tokens.info, 0.35), backgroundColor: alpha(tokens.info, 0.06), color: tokens.text },
                filledSuccess: { color: tokens.accentText },
            },
        },
        MuiBackdrop: {
            styleOverrides: { root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: 'rgba(0, 0, 0, 0.72)', backdropFilter: 'blur(4px)' } } },
        },
        MuiDialog: { styleOverrides: { paper: { backgroundColor: tokens.surface, border: `1px solid ${tokens.borderStrong}`, borderRadius: 12 } } },
        MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4, height: 6, backgroundColor: tokens.hover } } },
        MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: tokens.surfaceRaised, border: `1px solid ${tokens.borderStrong}`, fontSize: '0.75rem' } } },
        MuiLink: { defaultProps: { underline: 'hover' }, styleOverrides: { root: { color: tokens.accent, cursor: 'pointer' } } },
        MuiDivider: { styleOverrides: { root: { borderColor: tokens.border } } },
        MuiCheckbox: { styleOverrides: { root: { color: tokens.textFaint } } },
    },
});

export default theme;
