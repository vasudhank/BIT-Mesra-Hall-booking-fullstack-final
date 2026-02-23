import api from './axiosInstance';

export const listQueries = async (params = {}) => {
  const { data } = await api.get('/queries', { params, withCredentials: true });
  return data;
};

export const createQuery = async (payload) => {
  const { data } = await api.post('/queries', payload, { withCredentials: true });
  return data;
};

export const getQuery = async (id, params = {}) => {
  const { data } = await api.get(`/queries/${id}`, { params, withCredentials: true });
  return data;
};

export const postQuerySolution = async (id, payload) => {
  const { data } = await api.post(`/queries/${id}/solutions`, payload, { withCredentials: true });
  return data;
};

export const postQueryQuickSolution = async (id, payload) => {
  const { data } = await api.post(`/queries/${id}/quick-solution`, payload, { withCredentials: true });
  return data;
};

export const reactQuerySolution = async (id, solutionId, payload) => {
  const { data } = await api.post(`/queries/${id}/solutions/${solutionId}/react`, payload, { withCredentials: true });
  return data;
};

export const postQueryReply = async (id, solutionId, payload) => {
  const { data } = await api.post(`/queries/${id}/solutions/${solutionId}/replies`, payload, { withCredentials: true });
  return data;
};

export const reactQueryReply = async (id, solutionId, replyId, payload) => {
  const { data } = await api.post(`/queries/${id}/solutions/${solutionId}/replies/${replyId}/react`, payload, { withCredentials: true });
  return data;
};

export const updateQueryStatus = async (id, payload) => {
  const { data } = await api.patch(`/queries/${id}/status`, payload, { withCredentials: true });
  return data;
};

export const acceptQuerySolution = async (id, solutionId) => {
  const { data } = await api.patch(`/queries/${id}/accept-solution/${solutionId}`, {}, { withCredentials: true });
  return data;
};
