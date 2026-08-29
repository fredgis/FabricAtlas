import { useId } from "react";

export interface TrendDatum {
  label: string;
  value: number;
}

export function TrendChart({
  title,
  data,
  valueLabel,
}: {
  title: string;
  data: TrendDatum[];
  valueLabel: (value: number) => string;
}) {
  const titleId = useId();
  const width = 720;
  const height = 220;
  const padding = { top: 22, right: 24, bottom: 44, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((point) => point.value), 1);
  const x = (index: number) =>
    padding.left +
    (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
  const y = (value: number) =>
    padding.top + innerHeight - (value / max) * innerHeight;
  const points = data.map((point, index) => `${x(index)},${y(point.value)}`);

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        className="h-auto w-full"
      >
        <title id={titleId}>{title}</title>
        {[0, 0.5, 1].map((ratio) => {
          const value = Math.round(max * ratio);
          const lineY = y(value);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                y1={lineY}
                x2={width - padding.right}
                y2={lineY}
                stroke="var(--color-border)"
                strokeDasharray={ratio === 0 ? undefined : "3 6"}
              />
              <text
                x={padding.left - 10}
                y={lineY + 4}
                textAnchor="end"
                fill="var(--color-muted-foreground)"
                fontSize="11"
              >
                {valueLabel(value)}
              </text>
            </g>
          );
        })}
        {data.length > 1 && (
          <polygon
            points={[
              `${x(0)},${y(0)}`,
              ...points,
              `${x(data.length - 1)},${y(0)}`,
            ].join(" ")}
            fill="color-mix(in srgb, var(--color-primary) 12%, transparent)"
          />
        )}
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--color-brand-foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle
              cx={x(index)}
              cy={y(point.value)}
              r="5"
              fill="var(--color-card)"
              stroke="var(--color-brand-foreground)"
              strokeWidth="3"
            />
            {(index === 0 ||
              index === data.length - 1 ||
              data.length <= 6) && (
              <text
                x={x(index)}
                y={height - 17}
                textAnchor="middle"
                fill="var(--color-muted-foreground)"
                fontSize="11"
              >
                {point.label}
              </text>
            )}
            <title>
              {point.label}: {valueLabel(point.value)}
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}
