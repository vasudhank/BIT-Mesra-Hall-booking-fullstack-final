import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import AdminHall from '../components/Dashboard/AdminHall/AdminHall';

export default function AdminHallRoute() {
  const user = useSelector((state) => state.user);

  if (user.status === 'Checking') {
    return null;
  }

  if (user.status !== 'Authenticated') {
    return <Navigate to="/admin_login" replace />;
  }

  if (user.user !== 'Admin') {
    return <Navigate to="/" replace />;
  }

  return <AdminHall />;
}
