import api from './axiosInstance';

export const listFeedback = async (params = {}) => {
  const { data } = await api.get('/feedback', { params, withCredentials: true });
  return data;
};

export const createFeedback = async (payload) => {
  const { data } = await api.post('/feedback', payload, { withCredentials: true });
  return data;
};

export const updateFeedbackStatus = async (id, payload) => {
  const { data } = await api.patch(`/feedback/${id}/status`, payload, { withCredentials: true });
  return data;
};

