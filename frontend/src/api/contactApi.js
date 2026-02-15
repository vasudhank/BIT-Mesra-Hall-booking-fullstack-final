import api from './axiosInstance'; // Assuming you have a centralized axios instance

export const getContactsApi = async () => {
  try {
    const response = await api.get('/contact/get_contacts');
    return response;
  } catch (error) {
    return { error: error.response?.data?.error || "Network Error" };
  }
};

export const adminUpdateContactApi = async (contactId, inputData) => {
  try {
    const response = await api.patch(`/contact/admin_update/${contactId}`, inputData);
    return response;
  } catch (error) {
    if (error.response) {
      throw error.response;
    }
    throw error;
  }
};
