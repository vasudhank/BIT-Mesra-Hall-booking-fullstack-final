import axios from 'axios';

export const cancelDepartmentApi = async (inputData) => {
  try {
    const options = {
        method: 'POST',
        url: 'http://localhost:8000/api/department/delete_department_request',
        headers: {
          'content-type': 'application/json',
        },
        withCredentials: true,
        data:inputData
    };


    let response = await axios(options);
    return response


  } catch (error) {
  if (error.response) {
    console.error(error.response.data);
  } else {
    console.error("Network or server error:", error.message);
  }
}

};