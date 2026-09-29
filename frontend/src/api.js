// Same origin by default: the dev server proxies /api to the backend (see "proxy" in package.json),
// and in production the backend serves this app itself.
const API_URL = process.env.REACT_APP_API_URL || '';

// The session lives in an HttpOnly cookie that page scripts cannot read. Every request sends it along with
// a custom header the backend requires on changes (blocks cross-site request forgery).
const request = async (endpoint, options = {}) => {
    const headers = { 'X-Requested-With': 'MonitorMail', ...options.headers };
    // For FormData, let the browser set the Content-Type
    if (options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers, credentials: 'include' });

    if (!response.ok) {
        let errorData;
        try {
            errorData = await response.json();
        } catch (e) {
            errorData = { message: response.status === 413 ? 'File is too large.' : 'Something went wrong. Please try again.' };
        }
        if (errorData.code === 'session_expired' && !endpoint.startsWith('/api/auth/me')) {
            window.dispatchEvent(new CustomEvent('mm:session-expired'));
        }
        const error = new Error(errorData.message || errorData.error || errorData.reason || 'Something went wrong. Please try again.');
        error.status = response.status;
        throw error;
    }

    if (response.status === 204) {
        return null;
    }
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.indexOf('application/json') !== -1) {
        return response.json();
    }
    // Assume blob for file downloads like Excel
    return response.blob();
};

// --- AUTH ---
export const login = (email, password) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
});

// Returns { user } when the session cookie is valid, otherwise throws
export const me = () => request('/api/auth/me', { method: 'GET' });

export const logout = () => request('/api/auth/logout', { method: 'POST' });

// --- TEACHER REGISTRATION (email OTP, then admin approval) ---
export const requestRegistrationOtp = (details) => request('/api/auth/register/request-otp', {
    method: 'POST',
    body: JSON.stringify(details),
});

export const verifyRegistrationOtp = (email, otp) => request('/api/auth/register/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
});

// --- PASSWORD ---
export const requestPasswordReset = (email) => request('/api/auth/password/request-reset', { method: 'POST', body: JSON.stringify({ email }) });
export const resetPassword = (email, otp, newPassword) => request('/api/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ email, otp, new_password: newPassword }),
});
export const changePassword = (currentPassword, newPassword) => request('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
});

// Checks the Gmail app password without sending anything
export const testEmailConnection = (gmailAppPassword) => request('/api/email/test-connection', {
    method: 'POST',
    body: JSON.stringify({ gmail_app_password: gmailAppPassword }),
});

// --- WORKFLOW ---
export const uploadPdf = (file) => {
    const formData = new FormData();
    formData.append('file', file);
    // Note: 'Content-Type' header is NOT set here for FormData
    return request('/api/upload-pdf', { method: 'POST', body: formData });
};


export const sortAttendance = (csvData) => request('/api/sort-attendance', {
    method: 'POST',
    // Headers are set automatically by 'request' helper for JSON
    body: JSON.stringify({ csv_data: csvData }),
});

export const fetchStudentDetails = (csvData) => request('/api/fetch-details', {
    method: 'POST',
    body: JSON.stringify({ sorted_csv_data: csvData }),
});

// --- Mass Alert Function ---
export const sendMassAlert = (alertPayload, attachment) => {
    const formData = new FormData();
    formData.append('alert_payload', JSON.stringify(alertPayload));
    if (attachment) {
        formData.append('attachment', attachment);
    }
    return request('/api/alert-all', {
  
        method: 'POST',
        body: formData,
    });
};

// --- EMAIL (for Workflow) ---
export const sendEmails = (emailPayload, attachment) => {
    const formData = new FormData();
    // Append payload as a JSON string
    formData.append('email_payload', JSON.stringify(emailPayload)); 
    if (attachment) {
        formData.append('attachment', attachment);
    }
    // Note: 'Content-Type' header is NOT set here for FormData
    return request('/api/send-emails', {
        method: 'POST',
        body: formData, 
    });
};

// Excel report of the review list; returns a Blob
export const exportStructuredExcel = (students) => request('/api/export-excel-structured', {
    method: 'POST',
    body: JSON.stringify({ students }),
});

export const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// --- API Functions for Categories 1, 2 & 3 ---

// Analytics
export const getDashboardAnalytics = () => request('/api/dashboard-analytics', { method: 'GET' });
// Teacher Management (Admin Only)
export const getTeachers = () => request('/api/teachers', { method: 'GET' });

export const saveTeacher = (teacher) => {
    // Determine endpoint and method based on whether it's a new teacher (no id) or existing
    const endpoint = teacher.id ? `/api/teachers/${teacher.id}` : '/api/teachers';
    const method = teacher.id ? 'PUT' : 'POST';
    // Create a copy of the teacher object to potentially remove the password
    const payload = { ...teacher };
    // Only include password if it's being set/changed (not blank)
    if (!payload.password) {
        delete payload.password;
    }
    
    return request(endpoint, {
        method,
        body: JSON.stringify(payload),
    });
};

export const deleteTeacher = (id) => request(`/api/teachers/${id}`, { method: 'DELETE' });

// Security log (Admin Only)
export const getAuditLog = () => request('/api/audit-log?limit=300', { method: 'GET' });

// Teacher approvals (Admin Only)
export const getPendingTeachers = () => request('/api/teachers?status=pending', { method: 'GET' });
export const approveTeacher = (id) => request(`/api/teachers/${id}/approve`, { method: 'POST' });
export const rejectTeacher = (id) => request(`/api/teachers/${id}/reject`, { method: 'POST' });

// --- RE-ADDED STUDENT MANAGEMENT FUNCTIONS ---
export const getStudents = (searchQuery = '') => request(`/api/students?search=${encodeURIComponent(searchQuery)}`, { method: 'GET' });

export const saveStudent = (student) => {
    const endpoint = student.id ? `/api/students/${student.id}` : '/api/students';
    const method = student.id ? 'PUT' : 'POST';
    return request(endpoint, {
        method,
        body: JSON.stringify(student),
    });
};

export const importStudents = (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('/api/students/import', { method: 'POST', body: formData });
};

export const deleteStudent = (id) => request(`/api/students/${id}`, { method: 'DELETE' 
});


// --- Template Management ---
export const getTemplates = () => request('/api/templates', { method: 'GET' });

export const saveTemplate = (template) => {
    const endpoint = template.id ? `/api/templates/${template.id}` : '/api/templates';
    const method = template.id ? 'PUT' : 'POST';
    return request(endpoint, {
        method,
        body: JSON.stringify(template),
    });
};

export const deleteTemplate = (id) => request(`/api/templates/${id}`, { method: 'DELETE' 
});

// --- History ---
export const getHistory = (searchQuery = '') => request(`/api/history?search=${encodeURIComponent(searchQuery)}`, { method: 'GET' });

// --- Email Monitoring (Phase 1) ---
export const listMonitors = () => request('/api/monitors', { method: 'GET' });
export const createMonitor = (monitor) => request('/api/monitors', { method: 'POST', body: JSON.stringify(monitor) });
export const deleteMonitor = (id) => request(`/api/monitors/${id}`, { method: 'DELETE' });
export const getMonitorMatches = (id) => request(`/api/monitors/${id}/matches`, { method: 'GET' });

