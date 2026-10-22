// Google sign-in allowlist. Firestore rules repeat these emails;
// keep the two lists the same.

export const PEOPLE = [
  {
    email: "sambrookhouser@gmail.com",
    name: "Sam",
    role: "kid",
    kidId: "sam",
  },
  {
    email: "wilsonbrookhouser@gmail.com",
    name: "Wally",
    role: "kid",
    kidId: "wally",
  },
  {
    email: "brookhouser@gmail.com",
    name: "Kevin",
    role: "admin",
  },
  {
    email: "bbrookhouser@gmail.com",
    name: "Beth",
    role: "admin",
  },
];

export function personByEmail(email) {
  if (!email) return null;
  const key = String(email).trim().toLowerCase();
  return PEOPLE.find((person) => person.email === key) || null;
}

export function personName(email) {
  return personByEmail(email)?.name || "";
}
