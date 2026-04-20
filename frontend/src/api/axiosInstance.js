import axios from 'axios';
import { resolveApiBaseUrl } from './apiBase';

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
