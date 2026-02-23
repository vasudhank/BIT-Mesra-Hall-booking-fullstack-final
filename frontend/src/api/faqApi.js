import api from './axiosInstance';

export const listFaqs = async (params = {}) => {
  const { data } = await api.get('/faq', { params, withCredentials: true });
  return data;
};

export const askFaqAi = async (payload) => {
  const { data } = await api.post('/faq/answer-with-ai', payload, { withCredentials: true });
  return data;
};

export const createFaq = async (payload) => {
  const { data } = await api.post('/faq', payload, { withCredentials: true });
  return data;
};

export const updateFaq = async (id, payload) => {
  const { data } = await api.patch(`/faq/${id}`, payload, { withCredentials: true });
  return data;
};

export const deleteFaq = async (id) => {
  const { data } = await api.delete(`/faq/${id}`, { withCredentials: true });
  return data;
};

