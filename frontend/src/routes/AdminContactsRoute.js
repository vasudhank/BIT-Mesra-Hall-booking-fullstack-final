import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import Loading from '../components/Loading/Loading';
import AdminContacts from '../components/Dashboard/AdminContacts/AdminContacts';

export default function AdminContactsRoute() {
  const user = useSelector((state) => state.user);

  if (user.status === 'Checking') {
    return <Loading />;
  }

  if (user.status !== 'Authenticated') {
    return <Navigate to="/admin_login" replace />;
  }

  if (user.user !== 'Admin') {
    return <Navigate to="/" replace />;
  }

  return <AdminContacts />;
}
