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
