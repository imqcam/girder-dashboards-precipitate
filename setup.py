from pathlib import Path

from setuptools import find_packages, setup

this_directory = Path(__file__).parent
long_description = (this_directory / "README.md").read_text()

# The scientific stack the analysis itself needs. A hard requirement, not an
# extra: this package is one dashboard, and a dashboard that can only explain
# that it cannot compute anything is not worth installing. It was an `analysis`
# extra at first, which cost more than it saved — deployment tooling that installs
# plugins with a plain `pip install -e .` skipped it silently, and it had to be
# remembered separately for the Girder and the Celery worker environment.
# Grouped and named so that the correspondence with
# ``girder_dashboards_precipitate.REQUIREMENTS`` stays visible; it is asserted by
# ``tests/test_packaging.py``, which parses this list out of this file.
ANALYSIS_REQUIREMENTS = [
    "numpy>=1.24",
    "scipy>=1.10",
    "scikit-image>=0.21",
    "tifffile>=2023.7.10",
    # TIFFs out of SEM software are usually LZW- or deflate-compressed, which
    # tifffile delegates to imagecodecs.
    "imagecodecs>=2023.3.16",
    "pillow>=9",
    "imageio>=2.28",
]

setup(
    name="girder-dashboards-precipitate",
    version="0.1.0",
    description=(
        "Precipitate detection and inter-particle spacing analysis, "
        "as a girder-dashboards dashboard"
    ),
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Kacper Kowalik",
    license="BSD-3-Clause",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Environment :: Web Environment",
        "License :: OSI Approved :: BSD License",
        "Operating System :: POSIX :: Linux",
        "Programming Language :: Python",
        "Programming Language :: Python :: 3",
    ],
    packages=find_packages(exclude=["girder_dashboards_precipitate.tests"]),
    include_package_data=True,
    python_requires=">=3.10",
    install_requires=[
        "girder-dashboards>=0.2",
        # The analysis is scheduled as a job on the Celery 'local' queue, with an
        # in-process fallback. Both need these; girder-dashboards itself does not,
        # which is why they are declared here and not there.
        "girder-jobs>=5",
        "girder-worker>=5",
    ]
    + ANALYSIS_REQUIREMENTS,
    entry_points={
        "girder.plugin": [
            "dashboards_precipitate = girder_dashboards_precipitate.plugin:PrecipitatePlugin"
        ],
        # Makes this package's Celery tasks discoverable by girder_worker, which
        # builds CELERY_INCLUDE from this entry point group at worker startup.
        "girder_worker_plugins": [
            "dashboards_precipitate = girder_dashboards_precipitate.worker_plugin:PrecipitateWorkerPlugin"  # noqa: E501
        ],
    },
    zip_safe=False,
)
