// CubicSpline.hpp
#pragma once
#include <vector>
#include <stdexcept>
#include <algorithm>

/**
 * @brief Cubic spline interpolator and smoother.
 *
 * Provides functionality for natural cubic spline interpolation and a simple smoothing spline
 * using local averaging before fitting.
 */
class CubicSpline
{
public:
  /**
   * @brief Fit a natural cubic spline that exactly interpolates the given data points.
   * @param x Vector of x-values (must be sorted and unique).
   * @param y Vector of y-values (same size as x).
   */
  void fit(const std::vector<double> &x, const std::vector<double> &y);

  /**
   * @brief Fit a smoothing cubic spline by locally averaging the input y-values.
   * @param x Vector of x-values (must be sorted and unique).
   * @param y Vector of y-values (same size as x).
   * @param lambda Smoothing factor [0.0 - 1.0]; 0 = no smoothing, 1 = full neighbor averaging.
   */
  void smoothFit(const std::vector<double> &x, const std::vector<double> &y, double lambda);

  /**
   * @brief Evaluate the spline at a given x-value.
   * @param x Input x-value within the domain of the fitted spline.
   * @return Interpolated or smoothed y-value.
   */
  double evaluate(double x) const;

  /**
   * @brief Choose a lambda for smoothFit that minimizes squared error.
   * @param x Vector of x-values.
   * @param y Vector of y-values.
   * @param lambda_start Starting lambda to try.
   * @param lambda_end Ending lambda to try.
   * @param lambda_step Step size.
   * @return Lambda with the lowest squared error.
   */
  double findBestSmoothing(const std::vector<double> &x, const std::vector<double> &y,
                           double lambda_start, double lambda_end, double lambda_step);

private:
  std::vector<double> x_, a_, b_, c_, d_;
};

// CubicSpline.cpp
#include "CubicSpline.hpp"
#include <limits>

void CubicSpline::fit(const std::vector<double> &x, const std::vector<double> &y)
{
  if (x.size() != y.size() || x.size() < 2)
    throw std::invalid_argument("Invalid input sizes for spline fitting.");

  int n = x.size();
  x_ = x;
  a_ = y;
  std::vector<double> h(n - 1), alpha(n - 1);

  for (int i = 0; i < n - 1; ++i)
    h[i] = x[i + 1] - x[i];

  for (int i = 1; i < n - 1; ++i)
    alpha[i] = (3.0 / h[i]) * (a_[i + 1] - a_[i]) - (3.0 / h[i - 1]) * (a_[i] - a_[i - 1]);

  std::vector<double> l(n), mu(n), z(n);
  l[0] = 1.0;
  mu[0] = z[0] = 0.0;

  for (int i = 1; i < n - 1; ++i)
  {
    l[i] = 2.0 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }

  l[n - 1] = 1.0;
  z[n - 1] = 0.0;
  c_.resize(n);
  b_.resize(n - 1);
  d_.resize(n - 1);
  c_[n - 1] = 0.0;

  for (int j = n - 2; j >= 0; --j)
  {
    c_[j] = z[j] - mu[j] * c_[j + 1];
    b_[j] = (a_[j + 1] - a_[j]) / h[j] - h[j] * (c_[j + 1] + 2.0 * c_[j]) / 3.0;
    d_[j] = (c_[j + 1] - c_[j]) / (3.0 * h[j]);
  }
}

void CubicSpline::smoothFit(const std::vector<double> &x, const std::vector<double> &y, double lambda)
{
  if (x.size() != y.size() || x.size() < 3)
    throw std::invalid_argument("Invalid input sizes for smoothing spline.");

  std::vector<double> y_smoothed = y;
  for (size_t i = 1; i < y.size() - 1; ++i)
  {
    y_smoothed[i] = (1 - lambda) * y[i] + lambda * 0.5 * (y[i - 1] + y[i + 1]);
  }
  fit(x, y_smoothed);
}

double CubicSpline::evaluate(double x) const
{
  auto it = std::upper_bound(x_.begin(), x_.end(), x);
  int i = std::max(int(it - x_.begin()) - 1, 0);
  double dx = x - x_[i];
  return a_[i] + b_[i] * dx + c_[i] * dx * dx + d_[i] * dx * dx * dx;
}

double CubicSpline::findBestSmoothing(const std::vector<double> &x, const std::vector<double> &y,
                                      double lambda_start, double lambda_end, double lambda_step)
{
  double best_lambda = lambda_start;
  double min_error = std::numeric_limits<double>::max();

  for (double lambda = lambda_start; lambda <= lambda_end; lambda += lambda_step)
  {
    smoothFit(x, y, lambda);
    double error = 0.0;
    for (size_t i = 0; i < x.size(); ++i)
    {
      double yi = evaluate(x[i]);
      double residual = yi - y[i];
      error += residual * residual;
    }
    if (error < min_error)
    {
      min_error = error;
      best_lambda = lambda;
    }
  }
  return best_lambda;
}

#if 0
// Usage Example
#include <iostream>
#include "CubicSpline.hpp"

int main() {
    std::vector<double> frame_times = {0.0, 0.033, 0.067, 0.100, 0.133};
    std::vector<double> dx = {0.05, 0.07, 0.10, 0.08};

    std::vector<double> mid_times;
    std::vector<double> velocities;
    for (size_t i = 0; i < dx.size(); ++i) {
        double t_mid = (frame_times[i] + frame_times[i + 1]) / 2.0;
        double v = dx[i] / (frame_times[i + 1] - frame_times[i]);
        mid_times.push_back(t_mid);
        velocities.push_back(v);
    }

    CubicSpline spline;
    spline.smoothFit(mid_times, velocities, 0.3); // lambda=0.3 controls smoothing strength

    double dt = 0.005;
    double pos = 0.0;
    for (double t = frame_times.front() + dt; t <= frame_times.back(); t += dt) {
        double v = spline.evaluate(t - dt/2);
        pos += v * dt;
        std::cout << "t=" << t << " s, position=" << pos << " px\n";
    }

    return 0;
}
#endif
