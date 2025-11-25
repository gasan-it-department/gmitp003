export const getYearRange = (isoDate: string) => {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  return {
    gte: new Date(`${year}-01-01T00:00:00.000Z`), // Start of year
    lte: new Date(`${year}-12-31T23:59:59.999Z`), // End of year
  };
};

export const formatDate = (isoDateString: string): string => {
  const date = new Date(isoDateString);

  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  return date.toLocaleDateString("en-US", options);
};

export const getPriceTotal = (
  price: { value: number; timestamp: Date }[],
  period: number,
  target: number
) => {
  const filtered = price.map((item) => {
    const month = new Date(item.timestamp).getMonth();
    const months = 12;
    const temp = months / period;
    const calMax = temp * target;
    const min = calMax - temp;

    if (month >= min && month <= calMax) {
      return item;
    }
  });
  return filtered
    .filter((item) => item !== undefined)
    .reduce((base, acc) => {
      return base + acc.value;
    }, 0);
};

export const getQuarter = (date = new Date()) => {
  const month = date.getMonth(); // 0-11 (January is 0)

  // Quarters: Q1 (0-2), Q2 (3-5), Q3 (6-8), Q4 (9-11)
  return Math.floor(month / 3) + 1;
};
