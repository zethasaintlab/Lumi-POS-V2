import { Button } from '../../../../../ds-bundle/components/forms/Button.jsx';

export function Bad() {
  return (
    <div style={{ color: '#ff0000', padding: '12px' }}>
      <Button variant="primary" bogusProp="x" />
      <Button variant="not-a-real-variant" />
    </div>
  );
}
