import axios from 'axios';

export const departmentLoginApi = async (inputData) => {
  try {
    const options = {
        method: 'POST',
        url: 'http://localhost:8000/api/department_login',
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

export const departmentSendOtpApi = async (data) => {
  return axios.post('http://localhost:8000/api/department/send_otp', data, { withCredentials:true });
};

export const departmentResetPasswordApi = async (data) => {
  return axios.post('http://localhost:8000/api/department/reset_password', data, { withCredentials:true });
};
