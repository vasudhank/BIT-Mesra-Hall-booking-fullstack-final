import api from './axiosInstance';

export const createDepartmentApi = async (inputData) => {
  try {
    return await api.post('/department/create', inputData);
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
