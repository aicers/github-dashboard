import {
  changeColor,
  formatChange,
  formatMetricValue,
  type MetricFormat,
  type MetricImpact,
} from "@/components/dashboard/metric-utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ComparisonValue,
  DurationComparisonValue,
} from "@/lib/dashboard/types";

type MetricCardProps = {
  title: string;
  description?: string;
  metric: ComparisonValue | DurationComparisonValue;
  format: MetricFormat;
  impact?: MetricImpact;
};

export function MetricCard({
  title,
  description,
  metric,
  format,
  impact = "positive",
}: MetricCardProps) {
  const valueMetric =
    format === "hours"
      ? {
          current: (metric as DurationComparisonValue).current,
          unit: (metric as DurationComparisonValue).unit,
        }
      : { current: metric.current };
  const valueLabel = formatMetricValue(valueMetric, format);
  const { changeLabel, percentLabel } = formatChange(metric, format);
  const changeClass = changeColor(impact, metric.absoluteChange);

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        {description && (
          <CardDescription className="text-xs text-muted-foreground">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pb-4">
        <span className="text-3xl font-semibold">{valueLabel}</span>
        <span className={`text-xs font-medium ${changeClass}`}>
          {changeLabel} ({percentLabel})
        </span>
      </CardContent>
    </Card>
  );
}
