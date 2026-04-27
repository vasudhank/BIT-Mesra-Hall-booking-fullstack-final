import { createSlice } from '@reduxjs/toolkit';
import api from '../../api/axiosInstance';

const initialState = {
  status: 'Checking',   // IMPORTANT
  user: null,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    // NEW names (used internally)
    setAuthenticated(state, action) {
      state.status = 'Authenticated';
      state.user = action.payload; // 'Admin' | 'Department'
    },
    setUnauthenticated(state) {
      state.status = 'Not Authenticated';
      state.user = null;
    },

    // ✅ OLD NAMES (aliases for backward compatibility)
    addStatus(state, action) {
      state.status = 'Authenticated';
      state.user = action.payload;
    },
    removeStatus(state) {
      state.status = 'Not Authenticated';
      state.user = null;
    },
  },
});

export const {
  setAuthenticated,
  setUnauthenticated,
  addStatus,
  removeStatus,
} = userSlice.actions;

export default userSlice.reducer;

/* ======================
   AUTH CHECK
====================== */
export function checkauth() {
  return async function (dispatch, getState) {
    try {
      const response = await api.get('/details');

      if (response.data.status === 'Authenticated') {
        dispatch(setAuthenticated(response.data.details.type));
      } else {
        const current = getState().user;
        // Avoid clobbering a fresh successful login with a stale in-flight check.
        if (current.status !== 'Authenticated') {
          dispatch(setUnauthenticated());
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      const current = getState().user;
      if (current.status !== 'Authenticated') {
        dispatch(setUnauthenticated());
      }
    }
  };
}
