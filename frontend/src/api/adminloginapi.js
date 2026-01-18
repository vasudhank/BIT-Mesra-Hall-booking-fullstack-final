import api from './axiosInstance';

/**
 * Admin login
 */
export const adminloginApi = async (inputData) => {
  try {
    const response = await api.post('/admin_login', inputData);
    return response;
  } catch (error) {
    if (error.response) {
      console.error(error.response.data);
      throw error.response;
    } else {
      console.error('Network or server error:', error.message);
      throw error;
    }
  }
};

/**
 * Send OTP to admin email
 */
export const adminSendOtpApi = async (data) => {
  try {
    return await api.post('/admin/send_otp', data);
  } catch (error) {
    if (error.response) {
      console.error(error.response.data);
      throw error.response;
    } else {
      console.error('Network or server error:', error.message);
      throw error;
    }
  }
};

/**
 * Reset admin password
 */
export const adminResetPasswordApi = async (data) => {
  try {
    return await api.post('/admin/reset_password', data);
  } catch (error) {
    if (error.response) {
      console.error(error.response.data);
      throw error.response;
    } else {
      console.error('Network or server error:', error.message);
      throw error;
    }
  }
};
