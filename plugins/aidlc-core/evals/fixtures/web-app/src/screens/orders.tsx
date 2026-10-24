import { formatDate } from "../lib/date";

type Order = { id: string; customer: string; total: number; createdAt: string };

/** Every order, newest first. */
export function OrdersScreen({ orders }: { orders: Order[] }) {
  const sorted = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section>
      <h1>Orders</h1>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Placed</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.customer}</td>
              <td>{o.total.toFixed(2)}</td>
              <td>{formatDate(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
