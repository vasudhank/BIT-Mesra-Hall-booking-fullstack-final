import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import Loading from '../components/Loading/Loading';
import AdminHall from '../components/Dashboard/AdminHall/AdminHall';

export default function AdminHallRoute() {
  const user = useSelector(state => state.user);

  // ⏳ Waiting for auth check to finish
  if (user.status === 'Checking') {
    return <Loading />;
  }

  // ❌ Not logged in
  if (user.status !== 'Authenticated') {
    return <Navigate to="/admin_login" replace />;
  }

  // ❌ Logged in but not admin
  if (user.user !== 'Admin') {
    return <Navigate to="/" replace />;
  }

  // ✅ Admin allowed
  return <AdminHall />;
}
