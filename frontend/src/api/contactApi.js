import api from './axiosInstance'; // Assuming you have a centralized axios instance

export const getContactsApi = async () => {
  try {
    const response = await api.get('/contact/get_contacts');
    return response;
  } catch (error) {
    return { error: error.response?.data?.error || "Network Error" };
  }
};