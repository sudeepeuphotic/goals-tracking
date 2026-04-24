export const ROLE = {
  ADMIN: "admin",
  MANAGER: "manager",
  DRI: "dri",
  CONTRIBUTOR: "contributor",
};

export function roleOf(user) {
  return user?.role || "";
}

export function isAdmin(user) {
  return roleOf(user) === ROLE.ADMIN;
}

export function isManager(user) {
  return roleOf(user) === ROLE.MANAGER;
}

export function isManagerOrAdmin(user) {
  return isAdmin(user) || isManager(user);
}
