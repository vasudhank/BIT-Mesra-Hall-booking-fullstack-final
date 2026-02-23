import api from './axiosInstance';

export const getAccount = async (role) => {
  const { data } = await api.get(`/account/${role}`, { withCredentials: true });
  return data;
};

export const updateAccountProfile = async (role, payload) => {
  const { data } = await api.patch(`/account/${role}/profile`, payload, { withCredentials: true });
  return data;
};

export const sendAccountEmailOtp = async (role, payload) => {
  const { data } = await api.post(`/account/${role}/send_email_otp`, payload, { withCredentials: true });
  return data;
};

export const verifyAccountEmailOtp = async (role, payload) => {
  const { data } = await api.post(`/account/${role}/verify_email_otp`, payload, { withCredentials: true });
  return data;
};

export const changeAccountPassword = async (role, payload) => {
  const { data } = await api.post(`/account/${role}/change_password`, payload, { withCredentials: true });
  return data;
};

