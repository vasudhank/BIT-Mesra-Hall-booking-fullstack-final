import api from './axiosInstance';

export const clearHallApi = async (inputData) => {
  try {
    const response = await api.post(
      '/hall/clear_hall',
      inputData
    );
    return response;
  } catch (error) {
    if (error.response) {
      console.error(error.response.data);
      throw error.response;
    } else {
      console.error('Network or server error:', error.message);
      throw error;
    }
  }
};
