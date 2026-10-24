import { formatDate } from "../lib/date";

type User = { id: string; name: string; email: string; createdAt: string };

/** Every user in the account, newest first. */
export function UsersScreen({ users }: { users: User[] }) {
  const sorted = [...users].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section>
      <h1>Users</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{formatDate(u.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
