import axios from 'axios';

// Create axios instance with base URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || '';

const apiClient = axios.create({
    baseURL: API_URL
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
