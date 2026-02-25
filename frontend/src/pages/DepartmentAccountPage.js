import React from 'react';
import RoleAccountPage from './RoleAccountPage';

export default function DepartmentAccountPage() {
  return (
    <RoleAccountPage
      role="department"
      backPath="/department/booking"
      title="Department Account"
    />
  );
}
