import api from './axiosInstance';

export const departmentLoginApi = async (inputData) => {
  try {
    const response = await api.post(
      '/department_login',
      inputData
    );
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

export const departmentSendOtpApi = async (data) => {
  try {
    const response = await api.post(
      '/department/send_otp',
      data
    );
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

export const departmentResetPasswordApi = async (data) => {
  try {
    const response = await api.post(
      '/department/reset_password',
      data
    );
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
