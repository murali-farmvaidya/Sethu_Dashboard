import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const BASE_URL = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;

// Create axios instance with default config
const api = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add token to requests automatically
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Handle 401 errors (unauthorized) globally
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || '';
        const isTokenIssue = errorMessage.toLowerCase().includes('token') ||
            errorMessage.toLowerCase().includes('expired') ||
            errorMessage.toLowerCase().includes('requester not found');

        if (error.response?.status === 401 && isTokenIssue) {
            console.warn('🔒 Session expired or invalid. Logging out...', errorMessage);
            localStorage.removeItem('token');
            if (!window.location.pathname.includes('/login')) {
                window.location.href = '/login';
            }
        } else if (error.response?.status === 401) {
            console.log('⚠️ 401 error suppressed from auto-logout:', errorMessage);
        }
        return Promise.reject(error);
    }
);

// Admin APIs (Mapped to available server endpoints)
export const adminAPI = {
    getAllAgents: (params) => api.get('agents', { params }),
    getStats: () => api.get('stats'),
    getActiveSessions: () => api.get('active-sessions'),
    deleteAgent: (agentId, permanent) => api.delete(`agents/${agentId}`, { params: { permanent } }),
    deleteSession: (sessionId, permanent) => api.delete(`sessions/${sessionId}`, { params: { permanent } }),
    restoreAgent: (agentId) => api.post(`agents/${agentId}/restore`),

    // User Management
    getUsers: (params) => api.get('users', { params }),
    getCreators: () => api.get('users/creators'),
    createUser: (data) => api.post('users', data),
    updateUser: (userId, data) => api.put(`users/${userId}`, data),

    // Actual actions calling the server
    toggleUserActive: (userId) => api.patch(`users/${userId}/active`),
    deleteUser: (userId) => api.delete(`users/${userId}`),
    sendPasswordReset: (userId) => api.post(`users/${userId}/reset-password`),

    // Agent Assignment
    getUserAgents: (userId) => api.get(`users/${userId}/agents`), // Note: Need to implement this in server if needed, but currently dashboard uses mockUsers
    assignAgent: (userId, data) => api.post(`users/${userId}/agents`, data),
    updateAgents: (userId, agents) => api.put(`users/${userId}/agents`, { agents }),
    getAgentMissedCalls: (agentId) => api.get(`agents/${agentId}/missed-calls`),
    markAgentMissedCallsRead: (agentId) => api.post(`agents/${agentId}/missed-calls/mark-read`)
};

// User APIs
export const userAPI = {
    // Dashboard - mock or reuse agents
    getDashboard: (params) => api.get('user/dashboard', { params }), // Approx
    getAgentDetails: (agentId) => api.get(`sessions`, { params: { agent_id: agentId, limit: 1 } }), // Hack to get stats from sessions endpoint meta

    getAgentSessions: (agentId, params) => api.get('sessions', { params: { ...params, agent_id: agentId } }),
    getSessionDetails: (sessionId) => api.get(`session/${sessionId}`),

    getSessionConversations: (sessionId, params) => api.get(`conversation/${sessionId}`), // Takes ID in path
    getConversationDetails: (conversationId) => Promise.resolve({ data: {} }), // Not implemented in server/index.js explicitly as ID lookup?
    getMissedCalls: () => api.get('user/missed-calls')
};

// Auth APIs
export const authAPI = {
    // Matches server/index.js: app.post('/api/login', { username, password })
    login: (username, password) => api.post('login', { username, password }),
    logout: () => {
        localStorage.removeItem('token');
        return Promise.resolve();
    },
    getProfile: () => api.get('me'),
    changePassword: (data) => api.post('change-password', data),
    forgotPassword: (email) => api.post('forgot-password', { email }),
    resetPasswordOtp: (data) => api.post('reset-password-otp', data),
    resetPasswordWithToken: (token, newPassword) => api.post('reset-password-token', { token, newPassword })
};

export const campaignAPI = {
    getAllCampaigns: (agentId) => api.get(`campaigns${agentId ? `?agentId=${agentId}` : ''}`),
    getCampaignCallDetails: (campaignId) => api.get(`campaigns/${campaignId}/calls`),
    createCampaign: (formData) => api.post('campaigns', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    }),
    deleteCampaign: (campaignId) => api.delete(`campaigns/${campaignId}`),
    stopCampaign: (campaignId) => api.post(`campaigns/${campaignId}/stop`),
    resumeCampaign: (campaignId) => api.post(`campaigns/${campaignId}/resume`),
};

export const paymentAPI = {
    createSubscription: () => api.post('payment/subscription/create'),
    createRecharge: (amount) => api.post('payment/minutes/create', { amount }),
    verifyPayment: (data) => api.post('payment/verify', data),
    getBalances: () => api.get('payment/balances'),
    getTransactionHistory: (filter = 'all', page = 1, limit = 50, direction = '', search = '', targetUserId = '') =>
        api.get('payment/history', { params: { filter, page, limit, ...(direction && { direction }), ...(search && { search }), ...(targetUserId && { targetUserId }) } }),
    adjustCredits: (amount, targetUserId) => api.post('payment/adjust-credits', { amount, targetUserId }),
    getHeatmap: (userId) => api.get('payment/heatmap', { params: userId ? { userId } : {} }),
};


// Settings APIs
export const settingsAPI = {
    getSettings: () => api.get('settings'),
    updateSettings: (settings) => api.put('settings', { settings }),
    getThrottleSettings: () => api.get('settings/throttle'),
};

export const notificationsAPI = {
    getNotifications: () => api.get('notifications'),
    markAsRead: (id) => api.patch(`notifications/${id}/read`),
    markAllAsRead: () => api.patch('notifications/read-all'),
};

export default api;
