document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map').setView([24.0, 45.0], 6);
    let markers = {};
    let heatLayer = null;
    let isHeatmap = false;
    let comparisonData = null;
    const colorPalette = ['#1E5631', '#FF5733', '#FFC107', '#28A745', '#007BFF', '#6F42C1', '#E83E8C'];

    // Base tile layer with fallback to Esri WorldStreetMap
    const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
        tileSize: 512,
        zoomOffset: -1
    }).addTo(map);

    // Fallback if OpenStreetMap fails
    const fallbackLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri'
    });

    map.on('tileerror', () => {
        map.removeLayer(baseLayer);
        fallbackLayer.addTo(map);
    });

    // Initialize tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    function initializeMultiSelects() {
        const multiSelects = document.querySelectorAll('select[multiple]');
        multiSelects.forEach(select => {
            select.setAttribute('size', '4');
            const helpText = document.createElement('small');
            helpText.className = 'form-text text-muted';
            helpText.textContent = 'Click to select/deselect multiple options.';
            select.parentNode.insertBefore(helpText, select.nextSibling);
            select.addEventListener('mousedown', function(e) {
                e.preventDefault();
                const option = e.target;
                if (option.tagName.toLowerCase() === 'option') {
                    option.selected = !option.selected;
                    const event = new Event('change', { bubbles: true });
                    this.dispatchEvent(event);
                }
            });
        });
    }

    function populateStationSelects() {
        fetch('/get-station-names')
            .then(response => response.json())
            .then(data => {
                const stationSelect = document.getElementById('stationSelect');
                const predictionStation = document.getElementById('predictionStation');
                const compareStations = document.getElementById('compareStations');
                
                data.stations.forEach(station => {
                    [stationSelect, predictionStation, compareStations].forEach(select => {
                        const option = document.createElement('option');
                        option.value = station;
                        option.textContent = station;
                        select.appendChild(option);
                    });
                });

                if (data.stations.length > 0) {
                    stationSelect.value = data.stations[0];
                    loadStationDetails(data.stations[0]);
                    updatePredictionInputs(data.stations[0]);
                }
                
                initializeMultiSelects();
            });
    }

    function loadMapData() {
        document.getElementById('map').innerHTML = '<p>Loading map...</p>';
        fetch('/map-data')
            .then(response => response.json())
            .then(data => {
                document.getElementById('map').innerHTML = '';
                data.forEach(station => {
                    const marker = L.marker([station.latitude, station.longitude], {
                        icon: L.icon({ iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png' })
                    })
                    .addTo(map)
                    .bindPopup(`<b>${station.station_name}</b><br>GHI: ${station.avg_ghi.toFixed(2)} Wh/m²`);

                    marker.on('mouseover', () => {
                        marker.setIcon(L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png' }));
                    });
                    marker.on('mouseout', () => {
                        marker.setIcon(L.icon({ iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png' }));
                    });
                    marker.on('click', () => {
                        document.getElementById('stationSelect').value = station.station_name;
                        loadStationDetails(station.station_name);
                    });

                    markers[station.station_name] = marker;
                });

                const heatData = data.map(station => [station.latitude, station.longitude, station.avg_ghi / 1000]);
                heatLayer = L.heatLayer(heatData, { radius: 25, blur: 15, maxZoom: 10 });
            })
            .catch(error => {
                console.error('Error loading map data:', error);
                document.getElementById('map').innerHTML = '<p>Error loading map</p>';
            });
    }

    document.getElementById('toggleHeatmap').addEventListener('click', () => {
        if (!heatLayer) return;
        isHeatmap = !isHeatmap;
        if (isHeatmap) {
            map.removeLayer(baseLayer);
            Object.values(markers).forEach(marker => map.removeLayer(marker));
            map.addLayer(heatLayer);
            document.getElementById('toggleHeatmap').textContent = 'Switch to Normal Map';
        } else {
            map.removeLayer(heatLayer);
            map.addLayer(baseLayer);
            Object.values(markers).forEach(marker => marker.addTo(map));
            document.getElementById('toggleHeatmap').textContent = 'Toggle Heatmap';
        }
    });

    function loadStationDetails(stationName) {
        fetch(`/station-details?station=${stationName}`)
            .then(response => response.json())
            .then(data => {
                const detailsDiv = document.getElementById('stationDetails');
                detailsDiv.innerHTML = `
                    <p><strong>Station:</strong> ${stationName}</p>
                    <p><strong>Latitude:</strong> ${data.details.latitude}</p>
                    <p><strong>Longitude:</strong> ${data.details.longitude}</p>
                `;

                const paramSelect = document.getElementById('parameterSelect');
                paramSelect.innerHTML = '';
                Object.keys(data.monthly_chart_data.data).forEach(param => {
                    const option = document.createElement('option');
                    option.value = param;
                    option.textContent = param;
                    paramSelect.appendChild(option);
                });
                
                if (paramSelect.options.length > 0) {
                    paramSelect.options[0].selected = true;
                }

                initializeMultiSelects();
                updateMonthlyChart(stationName);
                updateTrendChart(stationName);
            });
    }

    function updateMonthlyChart(stationName) {
        const selectedParams = Array.from(document.getElementById('parameterSelect').selectedOptions).map(opt => opt.value);
        const year = document.getElementById('mapViewYear')?.value || null;
        
        if (selectedParams.length === 0) {
            document.getElementById('monthlyChart').innerHTML = '<p>Please select at least one parameter</p>';
            return;
        }
        
        document.getElementById('monthlyChart').innerHTML = '<p>Loading chart...</p>';
        const queryParams = new URLSearchParams({
            station: stationName,
            year: year || ''
        });
        
        fetch(`/station-details?${queryParams}`)
            .then(response => response.json())
            .then(data => {
                const months = data.monthly_chart_data.months;
                const yearDisplay = year || new Date(data.details.date).getFullYear();
                
                const traces = selectedParams.map((param, index) => ({
                    x: months,
                    y: data.monthly_chart_data.data[param],
                    type: 'bar',
                    name: param,
                    hoverinfo: 'x+y',
                    marker: {
                        color: colorPalette[index % colorPalette.length],
                        line: { width: 1 }
                    }
                }));

                const layout = {
                    title: `Monthly Data for ${stationName} (${yearDisplay})`,
                    barmode: 'group',
                    height: 600,
                    legend: { 
                        orientation: 'h', 
                        y: -0.2,
                        xanchor: 'center',
                        x: 0.5 
                    },
                    xaxis: { title: 'Month' },
                    yaxis: { title: 'Value' },
                    margin: { t: 50, b: 100 }
                };

                Plotly.newPlot('monthlyChart', traces, layout);
            })
            .catch(error => {
                console.error('Error updating monthly chart:', error);
                document.getElementById('monthlyChart').innerHTML = '<p>Error loading chart data</p>';
            });
    }

    function updateTrendChart(stationName) {
        const selectedParams = Array.from(document.getElementById('parameterSelect').selectedOptions).map(opt => opt.value);
        const year = document.getElementById('mapViewYear')?.value || null;
        
        if (selectedParams.length === 0) {
            document.getElementById('trendChart').innerHTML = '<p>Please select at least one parameter</p>';
            return;
        }
        
        document.getElementById('trendChart').innerHTML = '<p>Loading trend...</p>';
        fetch(`/station-trend?station=${stationName}&year=${year || ''}`)
            .then(response => response.json())
            .then(data => {
                const traces = selectedParams.map((param, index) => ({
                    x: data.dates,
                    y: data.values[param],
                    type: 'scatter',
                    mode: 'lines',
                    name: param,
                    line: { color: colorPalette[index % colorPalette.length] }
                }));

                const layout = {
                    title: `Trend Over Time for ${stationName} (${year || 'All Years'})`,
                    height: 500,
                    xaxis: { title: 'Date' },
                    yaxis: { title: 'Value' },
                    legend: { orientation: 'h', y: -0.2, xanchor: 'center', x: 0.5 }
                };

                Plotly.newPlot('trendChart', traces, layout);
            })
            .catch(error => {
                console.error('Error updating trend chart:', error);
                document.getElementById('trendChart').innerHTML = '<p>Error loading trend data</p>';
            });
    }

    function loadStationComparison() {
        const selectedStations = Array.from(document.getElementById('compareStations').selectedOptions).map(opt => opt.value);
        const selectedParams = Array.from(document.getElementById('compareParams').selectedOptions).map(opt => opt.value);
        const year = document.getElementById('comparisonYear')?.value || null;

        if (selectedStations.length === 0 || selectedParams.length === 0) {
            document.getElementById('comparisonCharts').innerHTML = '<p>Please select stations and parameters</p>';
            return;
        }

        document.getElementById('comparisonCharts').innerHTML = '<p>Loading comparison...</p>';
        fetch('/station-comparison', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stations: selectedStations, params: selectedParams, year: year })
        })
        .then(response => response.json())
        .then(data => {
            comparisonData = data;
            const chartsDiv = document.getElementById('comparisonCharts');
            chartsDiv.innerHTML = '';

            selectedParams.forEach(param => {
                const traces = selectedStations.map((station, index) => ({
                    x: data.dates[station],
                    y: data.values[station][param],
                    type: 'scatter',
                    mode: 'lines',
                    name: station,
                    line: { color: colorPalette[index % colorPalette.length] }
                }));

                const div = document.createElement('div');
                div.id = `chart-${param}`;
                chartsDiv.appendChild(div);

                Plotly.newPlot(`chart-${param}`, traces, {
                    title: `${param} Comparison Across Stations`,
                    xaxis: { title: 'Date' },
                    yaxis: { title: param },
                    height: 500
                });
            });

            updateSummaryTable();
        })
        .catch(error => {
            console.error('Error loading comparison:', error);
            document.getElementById('comparisonCharts').innerHTML = '<p>Error loading comparison</p>';
        });
    }

    function updateSummaryTable() {
        if (!comparisonData) {
            document.getElementById('summaryStats').innerHTML = '<p>No comparison data available</p>';
            return;
        }
        
        const selectedStations = Array.from(document.getElementById('compareStations').selectedOptions).map(opt => opt.value);
        const summaryParam = document.getElementById('summaryParam').value;
        const statsTable = document.getElementById('summaryStats');
        
        let tableHtml = `<table class="summary-table"><thead><tr><th>Station</th><th>${summaryParam} Mean</th><th>${summaryParam} Min</th><th>${summaryParam} Max</th><th>${summaryParam} Std</th></tr></thead><tbody>`;

        selectedStations.forEach(station => {
            tableHtml += `<tr><td>${station}</td>`;
            ['mean', 'min', 'max', 'std'].forEach(stat => {
                const key = `${summaryParam}_${stat}`;
                const value = comparisonData.summary_stats[key]?.[station];
                tableHtml += `<td>${value !== undefined && value !== null ? value.toFixed(2) : 'N/A'}</td>`;
            });
            tableHtml += '</tr>';
        });

        tableHtml += '</tbody></table>';
        statsTable.innerHTML = tableHtml;
    }

    fetch('/data-analysis')
        .then(response => response.json())
        .then(data => {
            const paramSelect = document.getElementById('compareParams');
            const summaryParamSelect = document.getElementById('summaryParam');
            Object.keys(data.summary_stats).filter(key => key.endsWith('_mean')).forEach(key => {
                const param = key.replace('_mean', '');
                [paramSelect, summaryParamSelect].forEach(select => {
                    const option = document.createElement('option');
                    option.value = param;
                    option.textContent = param;
                    select.appendChild(option);
                });
            });
            
            if (paramSelect.options.length > 0) {
                paramSelect.options[0].selected = true;
            }
            if (summaryParamSelect.options.length > 0) {
                summaryParamSelect.options[0].selected = true;
            }
            
            initializeMultiSelects();

            // Populate ranges for prediction inputs
            const ranges = {};
            Object.keys(data.summary_stats).forEach(key => {
                const param = key.replace(/_(mean|min|max|std)$/, '');
                if (!ranges[param]) ranges[param] = {};
                if (key.endsWith('_min')) ranges[param].min = Math.min(...Object.values(data.summary_stats[key]));
                if (key.endsWith('_max')) ranges[param].max = Math.max(...Object.values(data.summary_stats[key]));
            });

            document.getElementById('tempRange').textContent = `Range: ${ranges['Air Temperature (C°)'].min.toFixed(2)} - ${ranges['Air Temperature (C°)'].max.toFixed(2)} °C`;
            document.getElementById('windRange').textContent = `Range: ${ranges['Wind Speed at 3m (m/s)'].min.toFixed(2)} - ${ranges['Wind Speed at 3m (m/s)'].max.toFixed(2)} m/s`;
            document.getElementById('dhiRange').textContent = `Range: ${ranges['DHI (Wh/m2)'].min.toFixed(2)} - ${ranges['DHI (Wh/m2)'].max.toFixed(2)} Wh/m²`;
            document.getElementById('dniRange').textContent = `Range: ${ranges['DNI (Wh/m2)'].min.toFixed(2)} - ${ranges['DNI (Wh/m2)'].max.toFixed(2)} Wh/m²`;
            document.getElementById('humidityRange').textContent = `Range: ${ranges['Relative Humidity (%)'].min.toFixed(2)} - ${ranges['Relative Humidity (%)'].max.toFixed(2)} %`;
            document.getElementById('pressureRange').textContent = `Range: ${ranges['Barometric Pressure (mB (hPa equiv))'].min.toFixed(2)} - ${ranges['Barometric Pressure (mB (hPa equiv))'].max.toFixed(2)} hPa`;
        });

    document.getElementById('predictionForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const predictionData = {
            'Station_Name': document.getElementById('predictionStation').value,
            'Air Temperature (C°)': parseFloat(document.getElementById('temperature').value).toFixed(2),
            'Wind Speed at 3m (m/s)': parseFloat(document.getElementById('wind_speed').value).toFixed(2),
            'DHI (Wh/m2)': parseFloat(document.getElementById('dhi').value).toFixed(2),
            'DNI (Wh/m2)': parseFloat(document.getElementById('dni').value).toFixed(2),
            'Relative Humidity (%)': parseFloat(document.getElementById('humidity').value).toFixed(2),
            'Barometric Pressure (mB (hPa equiv))': parseFloat(document.getElementById('pressure').value).toFixed(2)
        };

        document.getElementById('predictionResult').innerHTML = '<p>Predicting...</p>';
        fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(predictionData)
        })
        .then(response => response.json())
        .then(data => {
            document.getElementById('predictionResult').innerHTML = data.prediction
                ? `<div class="alert alert-success">Predicted GHI: ${parseFloat(data.prediction).toFixed(2)} Wh/m²</div>`
                : `<div class="alert alert-danger">Prediction Error: ${data.error}</div>`;
        });
    });

    document.getElementById('stationSelect').addEventListener('change', (e) => loadStationDetails(e.target.value));
    document.getElementById('parameterSelect').addEventListener('change', () => {
        const station = document.getElementById('stationSelect').value;
        updateMonthlyChart(station);
        updateTrendChart(station);
    });
    document.getElementById('mapViewYear').addEventListener('change', () => {
        const station = document.getElementById('stationSelect').value;
        updateMonthlyChart(station);
        updateTrendChart(station);
    });
    document.getElementById('predictionStation').addEventListener('change', (e) => updatePredictionInputs(e.target.value));
    document.getElementById('compareStations').addEventListener('change', loadStationComparison);
    document.getElementById('compareParams').addEventListener('change', loadStationComparison);
    document.getElementById('comparisonYear').addEventListener('change', loadStationComparison);
    document.getElementById('summaryParam').addEventListener('change', updateSummaryTable);

    populateStationSelects();
    loadMapData();

    function updatePredictionInputs(stationName) {
        fetch(`/station-details?station=${stationName}`)
            .then(response => response.json())
            .then(data => {
                document.getElementById('temperature').value = data.mean_values['Air Temperature (C°)'].toFixed(2);
                document.getElementById('wind_speed').value = data.mean_values['Wind Speed at 3m (m/s)'].toFixed(2);
                document.getElementById('dhi').value = data.mean_values['DHI (Wh/m2)'].toFixed(2);
                document.getElementById('dni').value = data.mean_values['DNI (Wh/m2)'].toFixed(2);
                document.getElementById('humidity').value = data.mean_values['Relative Humidity (%)'].toFixed(2);
                document.getElementById('pressure').value = data.mean_values['Barometric Pressure (mB (hPa equiv))'].toFixed(2);
            });
    }
});