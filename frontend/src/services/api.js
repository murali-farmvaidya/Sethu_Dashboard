import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Create axios instance with default config
const api = axios.create({
    baseURL: API_URL,
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
    getAllAgents: (params) => api.get('/api/agents', { params }),
    getStats: () => api.get('/api/stats'),
    deleteAgent: (agentId, permanent) => api.delete(`/api/agents/${agentId}`, { params: { permanent } }),
    deleteSession: (sessionId, permanent) => api.delete(`/api/sessions/${sessionId}`, { params: { permanent } }),
    restoreAgent: (agentId) => api.post(`/api/agents/${agentId}/restore`),

    // User Management
    getUsers: (params) => api.get('/api/users', { params }),
    getCreators: () => api.get('/api/users/creators'),
    createUser: (data) => api.post('/api/users', data),
    updateUser: (userId, data) => api.put(`/api/users/${userId}`, data),

    // Actual actions calling the server
    toggleUserActive: (userId) => api.patch(`/api/users/${userId}/active`),
    deleteUser: (userId) => api.delete(`/api/users/${userId}`),
    sendPasswordReset: (userId) => api.post(`/api/users/${userId}/reset-password`),

    // Agent Assignment
    getUserAgents: (userId) => api.get(`/api/users/${userId}/agents`), // Note: Need to implement this in server if needed, but currently dashboard uses mockUsers
    assignAgent: (userId, data) => api.post(`/api/users/${userId}/agents`, data),
    updateAgents: (userId, agents) => api.put(`/api/users/${userId}/agents`, { agents }),
};

// User APIs
export const userAPI = {
    // Dashboard - mock or reuse agents
    getDashboard: (params) => api.get('/api/user/dashboard', { params }), // Approx
    getAgentDetails: (agentId) => api.get(`/api/sessions`, { params: { agent_id: agentId, limit: 1 } }), // Hack to get stats from sessions endpoint meta

    getAgentSessions: (agentId, params) => api.get('/api/sessions', { params: { ...params, agent_id: agentId } }),
    getSessionDetails: (sessionId) => api.get(`/api/session/${sessionId}`),

    getSessionConversations: (sessionId, params) => api.get(`/api/conversation/${sessionId}`), // Takes ID in path
    getConversationDetails: (conversationId) => Promise.resolve({ data: {} }) // Not implemented in server/index.js explicitly as ID lookup?
};

// Auth APIs
export const authAPI = {
    // Matches server/index.js: app.post('/api/login', { username, password })
    login: (username, password) => api.post('/api/login', { username, password }),
    logout: () => {
        localStorage.removeItem('token');
        return Promise.resolve();
    },
    getProfile: () => api.get('/api/me'),
    changePassword: (data) => api.post('/api/change-password', data),
    forgotPassword: (email) => api.post('/api/forgot-password', { email }),
    resetPasswordOtp: (data) => api.post('/api/reset-password-otp', data),
    resetPasswordWithToken: (token, newPassword) => api.post('/api/reset-password-token', { token, newPassword })
};

export const campaignAPI = {
    getAllCampaigns: () => api.get('/api/campaigns'),
    getCampaignCallDetails: (campaignId) => api.get(`/api/campaigns/${campaignId}/calls`),
    createCampaign: (formData) => api.post('/api/campaigns', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    }),
    deleteCampaign: (campaignId) => api.delete(`/api/campaigns/${campaignId}`),
    stopCampaign: (campaignId) => api.post(`/api/campaigns/${campaignId}/stop`),
    resumeCampaign: (campaignId) => api.post(`/api/campaigns/${campaignId}/resume`),
};


export default api;
