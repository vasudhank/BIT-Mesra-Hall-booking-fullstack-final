import api from './axiosInstance';

export const deleteDepartmentApi = async (departmentId) => {
  try {
    return await api.delete(`/department/delete_department/${departmentId}`);
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
