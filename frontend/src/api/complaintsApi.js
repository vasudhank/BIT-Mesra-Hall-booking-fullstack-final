import api from './axiosInstance';

export const listComplaints = async (params = {}) => {
  const { data } = await api.get('/complaints', { params, withCredentials: true });
  return data;
};

export const createComplaint = async (payload) => {
  const { data } = await api.post('/complaints', payload, { withCredentials: true });
  return data;
};

export const getComplaint = async (id, params = {}) => {
  const { data } = await api.get(`/complaints/${id}`, { params, withCredentials: true });
  return data;
};

export const postComplaintSolution = async (id, payload) => {
  const { data } = await api.post(`/complaints/${id}/solutions`, payload, { withCredentials: true });
  return data;
};

export const postComplaintQuickSolution = async (id, payload) => {
  const { data } = await api.post(`/complaints/${id}/quick-solution`, payload, { withCredentials: true });
  return data;
};

export const updateComplaintSolution = async (id, solutionId, payload) => {
  const { data } = await api.patch(`/complaints/${id}/solutions/${solutionId}`, payload, { withCredentials: true });
  return data;
};

export const deleteComplaintSolution = async (id, solutionId) => {
  const { data } = await api.delete(`/complaints/${id}/solutions/${solutionId}`, { withCredentials: true });
  return data;
};

export const reactComplaintSolution = async (id, solutionId, payload) => {
  const { data } = await api.post(`/complaints/${id}/solutions/${solutionId}/react`, payload, { withCredentials: true });
  return data;
};

export const postComplaintReply = async (id, solutionId, payload) => {
  const { data } = await api.post(`/complaints/${id}/solutions/${solutionId}/replies`, payload, { withCredentials: true });
  return data;
};

export const reactComplaintReply = async (id, solutionId, replyId, payload) => {
  const { data } = await api.post(`/complaints/${id}/solutions/${solutionId}/replies/${replyId}/react`, payload, { withCredentials: true });
  return data;
};

export const updateComplaintStatus = async (id, payload) => {
  const { data } = await api.patch(`/complaints/${id}/status`, payload, { withCredentials: true });
  return data;
};

export const acceptComplaintSolution = async (id, solutionId) => {
  const { data } = await api.patch(`/complaints/${id}/accept-solution/${solutionId}`, {}, { withCredentials: true });
  return data;
};

export const requestComplaintReopenOtp = async (id, payload) => {
  const { data } = await api.post(`/complaints/${id}/reopen/request-otp`, payload, { withCredentials: true });
  return data;
};

export const verifyComplaintReopenOtp = async (id, payload) => {
  const { data } = await api.post(`/complaints/${id}/reopen/verify-otp`, payload, { withCredentials: true });
  return data;
};
