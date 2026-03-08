import axios from 'axios';

// Create axios instance with base URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const BASE_URL = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;

const apiClient = axios.create({
    baseURL: BASE_URL
});

// Add token to requests
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default apiClient;
