import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle, LogOut, X } from 'lucide-react';

const DeactivationModal = () => {
    const { isDeactivated, deactivationCountdown, deactivationReason, logout } = useAuth();

    if (!isDeactivated) return null;

    const minutes = Math.floor(deactivationCountdown / 60);
    const seconds = deactivationCountdown % 60;

    return (
        <div className="deactivation-toast">
            <div className="toast-content">
                <div className="toast-header">
                    <div className="title-area">
                        <AlertTriangle size={20} className="warning-icon" />
                        <h3>Account Deactivated</h3>
                    </div>
                </div>
                <div className="toast-body">
                    <p>{deactivationReason || 'Your account has been deactivated by the administrator.'}</p>
                    <p>You will be automatically logged out in:</p>
                    <div className="countdown-display">
                        {minutes}:{seconds < 10 ? `0${seconds}` : seconds}
                    </div>
                    <p className="note">Please contact the admin for assistance.</p>
                </div>
                <div className="toast-footer">
                    <button onClick={logout} className="logout-now-btn">
                        <LogOut size={16} />
                        Logout Now
                    </button>
                </div>
            </div>

            <style>{`
                .deactivation-toast {
                    position: fixed;
                    top: 24px;
                    right: 24px;
                    width: 320px;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                    z-index: 10000;
                    border-left: 5px solid #dc2626;
                    animation: toast-slide-in 0.3s ease-out;
                    overflow: hidden;
                }

                @keyframes toast-slide-in {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                .toast-content {
                    padding: 20px;
                }

                .toast-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                }

                .title-area {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .title-area h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 700;
                    color: #111827;
                }

                .warning-icon {
                    color: #dc2626;
                    animation: pulse 2s infinite;
                }

                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }

                .toast-body p {
                    margin: 4px 0;
                    font-size: 13px;
                    color: #4b5563;
                    line-height: 1.4;
                }

                .countdown-display {
                    font-size: 28px;
                    font-weight: 800;
                    color: #dc2626;
                    margin: 12px 0;
                    font-variant-numeric: tabular-nums;
                    text-align: center;
                }

                .note {
                    font-size: 12px !important;
                    font-weight: 600;
                    color: #ef4444 !important;
                }

                .toast-footer {
                    margin-top: 16px;
                }

                .logout-now-btn {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 10px;
                    background: #111827;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 13px;
                    transition: background 0.2s;
                }

                .logout-now-btn:hover {
                    background: #000;
                }
            `}</style>
        </div>
    );
};

export default DeactivationModal;
