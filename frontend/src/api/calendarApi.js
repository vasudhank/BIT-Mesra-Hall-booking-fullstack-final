import api from './axiosInstance';

export const getCalendarEventsApi = async (params = {}) => {
  const response = await api.get('/calendar/events', { params, withCredentials: true });
  return response.data;
};

export const searchCalendarEventsApi = async (params = {}) => {
  const response = await api.get('/calendar/search', { params, withCredentials: true });
  return response.data;
};

export const getCalendarAppearanceApi = async () => {
  const response = await api.get('/calendar/appearance', { withCredentials: true });
  return response.data;
};

export const saveCalendarAppearanceApi = async (themeMode) => {
  const response = await api.put('/calendar/appearance', { themeMode }, { withCredentials: true });
  return response.data;
};

export const createCalendarTaskApi = async (payload) => {
  const response = await api.post('/calendar/tasks', payload, { withCredentials: true });
  return response.data;
};

export const updateCalendarTaskApi = async (taskId, payload) => {
  const response = await api.put(`/calendar/tasks/${taskId}`, payload, { withCredentials: true });
  return response.data;
};

export const deleteCalendarTaskApi = async (taskId) => {
  const response = await api.delete(`/calendar/tasks/${taskId}`, { withCredentials: true });
  return response.data;
};
