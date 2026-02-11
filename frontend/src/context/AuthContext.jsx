import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);
    const [isDeactivated, setIsDeactivated] = useState(false);
    const [deactivationCountdown, setDeactivationCountdown] = useState(300); // 5 minutes in seconds
    const [deactivationReason, setDeactivationReason] = useState(null);

    // Load user data on mount
    useEffect(() => {
        if (token) {
            loadUserData();
        } else {
            setLoading(false);
            setIsDeactivated(false);
            setDeactivationReason(null);
            setDeactivationCountdown(300);
        }
    }, [token]);

    // Check for deactivation periodically
    useEffect(() => {
        let pollInterval;
        let countdownInterval;

        if (token && user && user.id !== 'master_root_0') {
            console.log('Starting deactivation check for user:', user.email, user.role);
            pollInterval = setInterval(async () => {
                try {
                    const response = await authAPI.getProfile();
                    const userData = response.data.user;

                    if (userData && userData.isActive === false) {
                        console.log('User detected as inactive:', userData.email);
                        if (!isDeactivated) {
                            setIsDeactivated(true);
                            setDeactivationReason(userData.deactivationReason || 'Your account has been deactivated by the administrator.');
                        }
                    } else {
                        // Reset if reactivated by admin during countdown
                        if (isDeactivated) {
                            setIsDeactivated(false);
                            setDeactivationReason(null);
                        }
                        setDeactivationCountdown(300);
                    }
                } catch (error) {
                    console.error('Deactivation check failed:', error);
                    if (error.response?.status === 401) {
                        const errorMessage = error.response?.data?.error || error.response?.data?.message || '';
                        const isTokenIssue = errorMessage.toLowerCase().includes('token') ||
                            errorMessage.toLowerCase().includes('expired') ||
                            errorMessage.toLowerCase().includes('requester not found');
                        if (isTokenIssue) logout();
                    }
                }
            }, 5000); // Check every 5 seconds
        }

        if (isDeactivated) {
            countdownInterval = setInterval(() => {
                setDeactivationCountdown(prev => {
                    if (prev <= 1) {
                        clearInterval(countdownInterval);
                        logout();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }

        return () => {
            clearInterval(pollInterval);
            clearInterval(countdownInterval);
        };
    }, [token, user, isDeactivated]);

    const loadUserData = async () => {
        try {
            const response = await authAPI.getProfile(); // Uses /api/me
            setUser(response.data.user);
        } catch (error) {
            console.error('Failed to load user data:', error);
            logout();
        } finally {
            setLoading(false);
        }
    };

    const login = async (username, password) => {
        try {
            const response = await authAPI.login(username, password);

            // Handle server response format: { success: true, token, user }
            const { success, token: accessToken, user: userData, message } = response.data;

            if (!success) {
                return { success: false, error: message || 'Login failed' };
            }

            setToken(accessToken);
            setUser(userData);
            localStorage.setItem('token', accessToken);

            // Add role if missing for admin check
            if (userData && !userData.role) {
                userData.role = 'admin'; // Default to admin for mock
            }

            return { success: true, user: userData };
        } catch (error) {
            const message = error.response?.data?.message || error.response?.data?.error || 'Login failed';
            return { success: false, error: message };
        }
    };

    const logout = async () => {
        try {
            if (token) {
                await authAPI.logout();
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            setToken(null);
            setUser(null);
            localStorage.removeItem('token');
        }
    };

    const changePassword = async (currentPassword, newPassword) => {
        try {
            const response = await authAPI.changePassword({ oldPassword: currentPassword, newPassword });
            if (response.data.success) {
                return { success: true };
            }
            return { success: false, error: response.data.message };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || "Password change failed" };
        }
    };

    const value = {
        user,
        token,
        loading,
        login,
        logout,
        changePassword,
        isAdmin: user?.role === 'admin' || user?.role === 'super_admin',
        isSuperAdmin: user?.role === 'super_admin',
        isAuthenticated: !!token && !!user,
        isDeactivated,
        deactivationReason,
        deactivationCountdown
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
