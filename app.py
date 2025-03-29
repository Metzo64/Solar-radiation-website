import os
import pandas as pd
import numpy as np
import joblib
import plotly
import plotly.express as px
import plotly.graph_objs as go
import json
from flask import Flask, render_template, request, jsonify
import matplotlib.pyplot as plt
import seaborn as sns
import io
import base64

app = Flask(__name__)

def load_dataset():
    try:
        df = pd.read_csv("Miniproject/website/dataset.csv")
        df['Date'] = pd.to_datetime(df['Date'], format='%d-%m-%Y %H:%M')
        return df
    except Exception as e:
        print(f"Error loading dataset: {e}")
        return None

def load_model():
    model_path = r"Miniproject/website/nishantmodel.pkl"
    try:
        model = joblib.load(model_path)
        return model
    except Exception as e:
        print(f"Error loading model: {e}")
        return None

dataset = load_dataset()
model = load_model()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/map-data')
def map_data():
    if dataset is None:
        return jsonify({"error": "No dataset loaded"}), 500
    
    unique_stations = dataset.drop_duplicates(subset=['Station_Name'])
    avg_ghi = dataset.groupby('Station_Name')['GHI (Wh/m2)'].mean().to_dict()
    
    map_data = []
    for _, row in unique_stations.iterrows():
        station_data = {
            "station_name": row['Station_Name'],
            "latitude": float(row['Latitude']),
            "longitude": float(row['Longitude']),
            "avg_ghi": avg_ghi[row['Station_Name']]
        }
        map_data.append(station_data)
    
    return jsonify(map_data)

@app.route('/get-station-names')
def get_station_names():
    if dataset is None:
        return jsonify({"error": "No dataset loaded"}), 500
    
    return jsonify({"stations": dataset['Station_Name'].unique().tolist()})

@app.route('/station-details')
def station_details():
    station_name = request.args.get('station', '')
    year_filter = request.args.get('year', '')
    
    if dataset is None:
        return jsonify({"error": "No dataset loaded"}), 500
    
    numerical_cols = dataset.select_dtypes(include=[np.number]).columns.tolist()
    exclude_cols = ['Latitude', 'Longitude']
    numerical_cols = [col for col in numerical_cols if col not in exclude_cols]
    
    station_data_full = dataset[dataset['Station_Name'] == station_name]
    
    if year_filter and year_filter.isdigit():
        year = int(year_filter)
        station_data_filtered = station_data_full[station_data_full['Date'].dt.year == year]
        if station_data_filtered.empty:
            station_data_filtered = station_data_full
    else:
        station_data_filtered = station_data_full
    
    if station_data_filtered.empty:
        return jsonify({"error": "No data found for this station"}), 404
    
    first_row = station_data_filtered.iloc[0]
    details = {
        "station_name": station_name,
        "longitude": float(first_row['Longitude']),
        "latitude": float(first_row['Latitude']),
        "date": first_row['Date'].strftime('%Y-%m-%d %H:%M')
    }
    
    monthly_data = station_data_filtered.groupby(station_data_filtered['Date'].dt.month)[numerical_cols].mean()
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    
    all_months = pd.DataFrame(index=range(1, 13))
    monthly_data = all_months.join(monthly_data)
    monthly_data = monthly_data.fillna(0)
    
    monthly_chart_data = {
        "months": months,
        "data": {col: monthly_data[col].tolist() for col in numerical_cols}
    }
    
    mean_values = station_data_filtered[numerical_cols].mean().to_dict()
    for key in mean_values:
        mean_values[key] = float(mean_values[key])
    
    return jsonify({
        "details": details,
        "monthly_chart_data": monthly_chart_data,
        "mean_values": mean_values
    })

@app.route('/station-trend')
def station_trend():
    station_name = request.args.get('station', '')
    year_filter = request.args.get('year', '')
    
    if dataset is None:
        return jsonify({"error": "No dataset loaded"}), 500
    
    numerical_cols = dataset.select_dtypes(include=[np.number]).columns.tolist()
    exclude_cols = ['Latitude', 'Longitude']
    numerical_cols = [col for col in numerical_cols if col not in exclude_cols]
    
    station_data = dataset[dataset['Station_Name'] == station_name]
    
    if year_filter and year_filter.isdigit():
        year = int(year_filter)
        station_data = station_data[station_data['Date'].dt.year == year]
    
    if station_data.empty:
        return jsonify({"error": "No data found for this station"}), 404
    
    daily_data = station_data.groupby(station_data['Date'].dt.date)[numerical_cols].mean()
    dates = daily_data.index.strftime('%Y-%m-%d').tolist()
    values = {col: daily_data[col].tolist() for col in numerical_cols}
    
    return jsonify({"dates": dates, "values": values})

@app.route('/data-analysis')
def data_analysis():
    if dataset is None:
        return jsonify({"error": "No dataset loaded"}), 500
    
    numerical_cols = dataset.select_dtypes(include=[np.number]).columns.tolist()
    exclude_cols = ['Latitude', 'Longitude']
    numerical_cols = [col for col in numerical_cols if col not in exclude_cols]
    
    summary_stats = {}
    for col in numerical_cols:
        for stat in ['mean', 'min', 'max', 'std']:
            stat_key = f"{col}_{stat}"
            summary_stats[stat_key] = dataset.groupby('Station_Name')[col].agg(stat).to_dict()
    
    return jsonify({"summary_stats": summary_stats})

@app.route('/station-comparison', methods=['POST'])
def station_comparison():
    if dataset is None:
        return jsonify({"error": "No dataset loaded"}), 500
    
    data = request.json
    stations = data.get('stations', [])
    params = data.get('params', [])
    year = data.get('year')
    
    if not stations or not params:
        return jsonify({"error": "No stations or parameters selected"}), 400
    
    filtered_data = dataset[dataset['Station_Name'].isin(stations)]
    
    if year and year.isdigit():
        year_int = int(year)
        filtered_data = filtered_data[filtered_data['Date'].dt.year == year_int]
    
    if filtered_data.empty:
        return jsonify({"error": "No data found for selected stations"}), 404
    
    numerical_cols = dataset.select_dtypes(include=[np.number]).columns.tolist()
    exclude_cols = ['Latitude', 'Longitude']
    numerical_cols = [col for col in numerical_cols if col not in exclude_cols]
    
    dates = {}
    values = {}
    
    for station in stations:
        station_data = filtered_data[filtered_data['Station_Name'] == station]
        if not station_data.empty:
            dates[station] = station_data['Date'].dt.strftime('%Y-%m-%d').tolist()
            values[station] = {}
            for param in numerical_cols:
                if param in station_data.columns:
                    values[station][param] = station_data[param].tolist()
                else:
                    values[station][param] = []
    
    summary_stats = {}
    for param in numerical_cols:
        for stat in ['mean', 'min', 'max', 'std']:
            key = f"{param}_{stat}"
            summary_stats[key] = {}
            for station in stations:
                station_data = filtered_data[filtered_data['Station_Name'] == station]
                if not station_data.empty and param in station_data.columns:
                    value = station_data[param].agg(stat)
                    summary_stats[key][station] = round(float(value), 2) if pd.notnull(value) else None
                else:
                    summary_stats[key][station] = None
    
    return jsonify({
        "dates": dates,
        "values": values,
        "summary_stats": summary_stats
    })

@app.route('/predict', methods=['POST'])
def predict():
    if model is None:
        return jsonify({"error": "Model not loaded"}), 500
    
    input_data = request.json
    
    required_features = [
        'Air Temperature (C°)', 
        'Wind Speed at 3m (m/s)', 
        'DHI (Wh/m2)', 
        'DNI (Wh/m2)', 
        'Relative Humidity (%)', 
        'Barometric Pressure (mB (hPa equiv))'
    ]
    
    for feature in required_features:
        if feature not in input_data or not input_data[feature]:
            return jsonify({"error": f"Missing required feature: {feature}"}), 400
    
    prediction_input = pd.DataFrame({
        feature: [float(input_data[feature])] for feature in required_features
    })
    
    station_name = input_data.get('Station_Name')
    if station_name and model:
        stations = dataset['Station_Name'].unique()
        for i, station in enumerate(stations):
            prediction_input[f"Station_{i}"] = 1 if station == station_name else 0
    
    try:
        prediction = model.predict(prediction_input)[0]
        return jsonify({"prediction": float(prediction)})
    except Exception as e:
        return jsonify({"error": f"Prediction error: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True)