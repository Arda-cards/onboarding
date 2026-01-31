import { RawEmail } from '../types';

export const MOCK_EMAILS: RawEmail[] = [
  {
    id: 'msg_001',
    subject: 'Order Confirmation #4492 - Acme Supplies',
    sender: 'orders@acmesupplies.com',
    date: '2023-10-01T09:30:00Z',
    snippet: 'Thank you for your business. Here is your receipt...',
    body: `
      <h1>Order Confirmation</h1>
      <p>Date: October 1, 2023</p>
      <p>Order #: 4492</p>
      <table>
        <tr><th>Item</th><th>Qty</th><th>Price</th></tr>
        <tr><td>Industrial Paper Towels (Case of 12)</td><td>5</td><td>$45.00</td></tr>
        <tr><td>Hand Soap Refill (1 Gallon)</td><td>2</td><td>$12.50</td></tr>
        <tr><td>Trash Bags 50 Gallon (Roll)</td><td>10</td><td>$18.00</td></tr>
      </table>
      <p>Total: $430.00</p>
    `
  },
  {
    id: 'msg_002',
    subject: 'Your recent purchase from TechParts Inc',
    sender: 'billing@techparts.io',
    date: '2023-10-15T14:20:00Z',
    snippet: 'Your electronic components are on the way...',
    body: `
      Hello Team,
      Thanks for shopping with TechParts.
      Order Date: 2023-10-15
      
      Items:
      - USB-C Cables (Braided, 2m) x 50 @ $3.50 ea
      - HDMI Adapters 4K x 20 @ $8.00 ea
      
      Shipping: Free
      Total: $335.00
    `
  },
  {
    id: 'msg_003',
    subject: 'Order #4501 Confirmed',
    sender: 'orders@acmesupplies.com',
    date: '2023-10-22T10:00:00Z',
    snippet: 'Another order has been processed...',
    body: `
      <h1>Order Confirmation</h1>
      <p>Date: October 22, 2023</p>
      <p>Order #: 4501</p>
      <table>
        <tr><th>Item</th><th>Qty</th><th>Price</th></tr>
        <tr><td>Industrial Paper Towels (Case of 12)</td><td>4</td><td>$45.00</td></tr>
        <tr><td>Bleach Cleaner (Spray)</td><td>12</td><td>$4.50</td></tr>
      </table>
    `
  },
  {
    id: 'msg_004',
    subject: 'Invoice: Coffee Beans Monthly',
    sender: 'roastery@beanstream.com',
    date: '2023-10-05T08:00:00Z',
    snippet: 'Your monthly coffee supply...',
    body: `
      Invoice #9992
      Date: 2023-10-05
      
      1. Espresso Blend (5lb Bag) - Qty: 6 - Unit: $60.00
      2. Filter Blend (5lb Bag) - Qty: 4 - Unit: $55.00
    `
  },
  {
    id: 'msg_005',
    subject: 'Order #4588 - Restock',
    sender: 'orders@acmesupplies.com',
    date: '2023-11-12T11:15:00Z',
    snippet: 'Restock order processed...',
    body: `
      <h1>Order Confirmation</h1>
      <p>Date: November 12, 2023</p>
      <p>Order #: 4588</p>
      Items:
      - Industrial Paper Towels (Case of 12): 6 units @ $46.00
      - Trash Bags 50 Gallon (Roll): 8 units @ $18.50
    `
  },
  {
    id: 'msg_006',
    subject: 'Invoice: Coffee Beans',
    sender: 'roastery@beanstream.com',
    date: '2023-11-04T08:00:00Z',
    snippet: 'Fresh roast incoming...',
    body: `
      Invoice #10045
      Date: 2023-11-04
      
      1. Espresso Blend (5lb Bag) - Qty: 6 - Unit: $60.00
      2. Filter Blend (5lb Bag) - Qty: 5 - Unit: $55.00
    `
  }
];
