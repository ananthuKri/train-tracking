import { useMemo, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseTrainNumbers } from '@railtrack/shared';
import { TrainNumberInput } from './TrainNumberInput';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const parsed = useMemo(() => parseTrainNumbers(value), [value]);
  return <TrainNumberInput value={value} onChange={setValue} parsed={parsed} />;
}

describe('TrainNumberInput', () => {
  it('shows chips for valid numbers as the user types', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByTestId('train-input'), '12082, 12627 16348');
    const chips = screen.getAllByTestId('valid-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['12082', '12627', '16348']);
    expect(screen.queryByTestId('invalid-feedback')).not.toBeInTheDocument();
  });

  it('explains each invalid token inline', () => {
    render(<Harness initial="1234, abcde" />);
    const feedback = screen.getByTestId('invalid-feedback');
    expect(feedback).toHaveTextContent('2 entries not recognised');
    const items = within(feedback).getAllByTestId('invalid-item');
    expect(items[0]).toHaveTextContent('“1234” — Train numbers have 5 digits (add a leading 0 for special trains)');
    expect(items[1]).toHaveTextContent('“abcde” — Train numbers may only contain digits');
    expect(screen.getByTestId('train-input')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('valid-chip')).not.toBeInTheDocument();
  });

  it('notes that invalid entries will be skipped when valid ones exist', () => {
    render(<Harness initial="12082, 123456" />);
    expect(screen.getByTestId('invalid-feedback')).toHaveTextContent('1 entry not recognised — will be skipped');
    expect(screen.getByTestId('invalid-item')).toHaveTextContent('Train numbers have exactly 5 digits');
  });

  it('reports duplicates once', () => {
    render(<Harness initial={'12082\n12082, 12627, 12627'} />);
    expect(screen.getAllByTestId('valid-chip')).toHaveLength(2);
    expect(screen.getByTestId('duplicate-feedback')).toHaveTextContent('Duplicate numbers tracked once: 12082, 12627');
  });

  it('warns when more than 50 trains are entered', () => {
    const many = Array.from({ length: 51 }, (_, i) => String(10000 + i)).join(',');
    render(<Harness initial={many} />);
    expect(screen.getByTestId('too-many-feedback')).toHaveTextContent('You entered 51 trains — the limit is 50');
  });

  it('removes a chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial="12082, 12627" />);
    await user.click(screen.getByRole('button', { name: 'Remove train 12082' }));
    expect(screen.getByTestId('train-input')).toHaveValue('12627');
  });
});
