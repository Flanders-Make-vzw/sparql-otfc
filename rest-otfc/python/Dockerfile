FROM python:3.11-bullseye

EXPOSE 8008

# Create a new app directory in which the app will really run
# docker-compose is exected to map the latest source code to the src subdir of this one
WORKDIR /otfc

# Install app dependencies
COPY requirements.txt ./

# Install all Python requirements
RUN pip install -r requirements.txt

# Next the command starts the main python file (should be overwritten in docker-compose.yaml)
CMD ["python","otfc_python_demo.py"]
