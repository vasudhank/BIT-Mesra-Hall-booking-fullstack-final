import api from './axiosInstance';

/**
 * Cancel / delete department request (Admin)
 */
export const cancelDepartmentApi = async (inputData) => {
  try {
    const response = await api.post(
      '/department/delete_department_request',
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
