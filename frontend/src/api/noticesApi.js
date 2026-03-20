import api from './axiosInstance';

export const getNoticesApi = async (params = {}) => {
  const response = await api.get('/notices', { params, withCredentials: true });
  return response.data;
};

export const getNoticeByIdApi = async (id) => {
  const response = await api.get(`/notices/${id}`, { withCredentials: true });
  return response.data;
};

export const createNoticeApi = async (payload) => {
  const response = await api.post('/notices', payload, { withCredentials: true });
  return response.data;
};

export const getNoticeClosuresApi = async (params) => {
  const response = await api.get('/notices/closures', { params, withCredentials: true });
  return response.data;
};

export const updateNoticeApi = async (id, payload) => {
  const response = await api.patch(`/notices/${id}`, payload, { withCredentials: true });
  return response.data;
};

export const deleteNoticeApi = async (id) => {
  const response = await api.delete(`/notices/${id}`, { withCredentials: true });
  return response.data;
};

export const getTrashedNoticesApi = async (params = {}) => {
  const response = await api.get('/notices/trash', { params, withCredentials: true });
  return response.data;
};

export const getNoticeTrashRetentionApi = async () => {
  const response = await api.get('/notices/trash/retention', { withCredentials: true });
  return response.data;
};

export const updateNoticeTrashRetentionApi = async (retentionDays) => {
  const response = await api.patch(
    '/notices/trash/retention',
    { retentionDays },
    { withCredentials: true }
  );
  return response.data;
};

export const restoreNoticeApi = async (id) => {
  const response = await api.patch(`/notices/${id}/restore`, {}, { withCredentials: true });
  return response.data;
};

export const permanentlyDeleteNoticeApi = async (id) => {
  const response = await api.delete(`/notices/${id}/permanent`, { withCredentials: true });
  return response.data;
};
