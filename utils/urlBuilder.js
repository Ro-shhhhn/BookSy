
exports.buildPaginationUrl = (baseUrl, currentParams, page) => {
    const params = new URLSearchParams(currentParams);
    params.set('page', page);
    return `${baseUrl}?${params.toString()}`;
};