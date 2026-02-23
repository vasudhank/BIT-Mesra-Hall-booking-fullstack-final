import api from './axiosInstance';

export const developerLogin = async (payload) => {
  const { data } = await api.post('/developer_login', payload, { withCredentials: true });
  return data;
};

export const developerSendOtp = async (payload) => {
  const { data } = await api.post('/developer/send_otp', payload, { withCredentials: true });
  return data;
};

export const developerResetPassword = async (payload) => {
  const { data } = await api.post('/developer/reset_password', payload, { withCredentials: true });
  return data;
};

