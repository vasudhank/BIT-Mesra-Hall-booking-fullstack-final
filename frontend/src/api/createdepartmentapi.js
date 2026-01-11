import axios from 'axios';

export const createDepartmentApi = async (inputData) => {
  try {
    const options = {
        method: 'POST',
        url: 'http://localhost:8000/api/create_department',
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